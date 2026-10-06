#!/usr/bin/env python3
"""Build the Engagement showcase video from the Figma frame exports + beats.json.

    python3 assets/engagement/build.py            # build (uses voiceover clips if present)
    python3 assets/engagement/build.py --gen-vo   # synthesize missing/changed voiceover first
    python3 assets/engagement/build.py --draft    # 960x540, fast encode, for timing checks

Inputs
  beats.json                      the storyline: beats -> shots (frame, voiceover lines, motion)
  frames/<name>.png               one PNG per Figma frame (see storyline.md for the list)
  voiceover/<shot-id>.mp3         optional, one clip per shot (made by --gen-vo)

Output
  engagement.mp4                  1920x1080 30fps H.264 + AAC

Pipeline
  1. Each shot's duration = its voiceover clip length + tail (or a words-per-second estimate
     while the clips don't exist yet), so the picture always paces to the narration.
  2. Each frame is composited once onto a 3840x2160 canvas (warm background, rounded corners,
     soft shadow; dialogs are laid over their dimmed parent screen).
  3. ffmpeg renders each shot with a slow push-in (zoompan) from that canvas, crossfades the
     shots together (xfade), draws the corner disclaimer, and lays the voiceover clips at each
     shot's start time.

Needs: ffmpeg/ffprobe on PATH, Pillow (pip install Pillow). --gen-vo needs ELEVENLABS_API_KEY
and ELEVENLABS_VOICE_ID in the environment or in the repo's .env.
"""
import json, os, subprocess, sys, shutil, hashlib, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FRAMES = HERE / 'frames'
VO_DIR = HERE / 'voiceover'
BUILD = HERE / 'build'
OUT = HERE / 'engagement.mp4'

DRAFT = '--draft' in sys.argv
W, H = (960, 540) if DRAFT else (1920, 1080)
CW, CH = W * 2, H * 2            # canvases are rendered at 2x so the push-in never upsamples
FPS = 30
XFADE = 0.5                      # seconds of crossfade between shots
TAIL = 0.7                       # silence after a line before the next shot starts
MIN_SHOT = 2.5
WORDS_PER_SEC = 2.4              # estimate used until the real clips exist
BG = (243, 241, 236)
FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
FONT_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'

# ---------------------------------------------------------------- .env + helpers
def load_env():
    p = ROOT / '.env'
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"\''))

def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.exit(f"✗ {' '.join(str(c) for c in cmd[:3])} …\n{r.stderr[-2000:]}")
    return r.stdout

def media_duration(path):
    out = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)])
    return float(out.strip())

# ---------------------------------------------------------------- storyline -> flat shot list
spec = json.loads((HERE / 'beats.json').read_text())
shots = []
for bi, beat in enumerate(spec['beats']):
    for si, s in enumerate(beat['shots']):
        s = dict(s)
        s['id'] = f'{bi:02d}-{si:02d}'
        s['beat'] = beat['title']
        s['text'] = ' '.join(s.get('vo', [])) if s.get('vo') else ''
        shots.append(s)

# ---------------------------------------------------------------- voiceover (optional)
def gen_voiceover():
    load_env()
    key, voice = os.environ.get('ELEVENLABS_API_KEY'), os.environ.get('ELEVENLABS_VOICE_ID')
    if not key or not voice:
        sys.exit('✗ --gen-vo needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (env or .env)')
    model = os.environ.get('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2')
    fmt = os.environ.get('ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128')
    VO_DIR.mkdir(exist_ok=True)
    manifest_p = VO_DIR / 'manifest.json'
    manifest = json.loads(manifest_p.read_text()) if manifest_p.exists() else {}
    for s in shots:
        if not s['text']: continue
        mp3 = VO_DIR / f"{s['id']}.mp3"
        if mp3.exists() and manifest.get(s['id']) == s['text']:
            continue
        print(f"  • {s['id']}  \"{s['text'][:60]}…\"")
        req = urllib.request.Request(
            f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format={fmt}',
            data=json.dumps({
                'text': s['text'], 'model_id': model,
                'voice_settings': {'stability': 0.55, 'similarity_boost': 0.75, 'style': 0.15, 'use_speaker_boost': True},
            }).encode(),
            headers={'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
        with urllib.request.urlopen(req) as r:
            mp3.write_bytes(r.read())
        manifest[s['id']] = s['text']
        manifest_p.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'✓ voiceover up to date in {VO_DIR.relative_to(ROOT)}')

if '--gen-vo' in sys.argv:
    gen_voiceover()

# ---------------------------------------------------------------- durations
have_vo = False
for s in shots:
    tail = s.get('tail', TAIL)
    if s.get('card'):
        s['dur'] = float(s.get('hold', 4.0)); s['vo_path'] = None; continue
    mp3 = VO_DIR / f"{s['id']}.mp3"
    if s['text'] and mp3.exists():
        s['vo_path'] = mp3; s['dur'] = media_duration(mp3) + tail; have_vo = True
    else:
        s['vo_path'] = None
        s['dur'] = (len(s['text'].split()) / WORDS_PER_SEC + tail) if s['text'] else float(s.get('hold', 3.0))
    s['dur'] = max(MIN_SHOT, round(s['dur'], 2))

# shot i starts at sum(prev durs) - i*XFADE because each crossfade overlaps the previous shot
t = 0.0
for i, s in enumerate(shots):
    s['start'] = t
    t += s['dur'] - (XFADE if i < len(shots) - 1 else 0)
TOTAL = t

# ---------------------------------------------------------------- canvases (PIL)
from PIL import Image, ImageDraw, ImageFilter, ImageFont

BUILD.mkdir(exist_ok=True); (BUILD / 'canvas').mkdir(exist_ok=True); (BUILD / 'shots').mkdir(exist_ok=True)

def rounded_mask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=r, fill=255)
    return m

def paste_screen(canvas, img, box, dim=0):
    """Fit img inside box (x, y, w, h), centred, with rounded corners + soft shadow."""
    bx, by, bw, bh = box
    k = min(bw / img.width, bh / img.height)
    img = img.convert('RGB').resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    x, y = bx + (bw - img.width) // 2, by + (bh - img.height) // 2
    r = round(28 * CW / 3840)
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    off = round(28 * CW / 3840)
    sd.rounded_rectangle([x, y + off, x + img.width, y + img.height + off], radius=r, fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(48 * CW / 3840)))
    canvas.alpha_composite(shadow)
    if dim:
        img = Image.blend(img, Image.new('RGB', img.size, (20, 20, 20)), dim)
    canvas.paste(img, (x, y), rounded_mask(img.size, r))
    return (x, y, img.width, img.height, k)

def placeholder(name):
    im = Image.new('RGB', (1470, 802), (225, 223, 218))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT_BOLD, 44)
    d.text((735, 401), f'[ {name} ]', fill=(120, 118, 112), font=f, anchor='mm')
    return im

def load_frame(name):
    p = FRAMES / f'{name}.png'
    if p.exists(): return Image.open(p)
    print(f'  ! frames/{name}.png missing — using a placeholder')
    return placeholder(name)

def canvas_for(s):
    """Composite once per distinct look; return the PNG path."""
    key = s.get('card') or f"{s.get('over', '')}+{s['frame']}"
    out = BUILD / 'canvas' / (hashlib.md5(f'{key}|{CW}x{CH}'.encode()).hexdigest()[:10] + '.png')
    if out.exists(): return out
    c = Image.new('RGBA', (CW, CH), BG + (255,))
    if s.get('card') == 'disclaimer':
        d = ImageDraw.Draw(c)
        f = ImageFont.truetype(FONT, round(56 * CW / 3840))
        d.multiline_text((CW / 2, CH / 2), spec['disclaimer_card'], fill=(90, 88, 84), font=f,
                         anchor='mm', align='center', spacing=round(22 * CW / 3840))
    else:
        mx, my = round(CW * 0.046), round(CH * 0.056)
        box = (mx, my, CW - 2 * mx, CH - 2 * my)
        if s.get('over'):
            px, py, pw, ph, k = paste_screen(c, load_frame(s['over']), box, dim=0.45)
            dlg = load_frame(s['frame']).convert('RGB')
            dlg = dlg.resize((round(dlg.width * k), round(dlg.height * k)), Image.LANCZOS)
            paste_screen(c, dlg, (px + (pw - dlg.width) // 2, py + (ph - dlg.height) // 2, dlg.width, dlg.height))
        else:
            paste_screen(c, load_frame(s['frame']), box)
    c.convert('RGB').save(out)
    return out

# ---------------------------------------------------------------- per-shot clips (ffmpeg zoompan)
ANCHOR = {'center': (0.5, 0.5), 'right': (1.0, 0.5), 'left': (0.0, 0.5), 'sidebar': (0.0, 0.3), 'top': (0.5, 0.0)}

def render_shot(s):
    png = canvas_for(s)
    n = round(s['dur'] * FPS)
    z0, z1 = (1.0, 1.06) if s.get('kind', 'push') == 'push' else (1.0, 1.012)
    if s.get('focus'): z1 = 1.10
    ax, ay = ANCHOR.get(s.get('focus', 'center'), (0.5, 0.5))
    out = BUILD / 'shots' / f"{s['id']}.mp4"
    stamp = f"{png.name}|{n}|{z0}|{z1}|{ax}|{ay}|{W}"
    stamp_p = out.with_suffix('.stamp')
    if out.exists() and stamp_p.exists() and stamp_p.read_text() == stamp: return out
    vf = (f"zoompan=z='{z0}+({z1}-{z0})*on/{n}':d={n}:fps={FPS}"
          f":x='(iw-iw/zoom)*{ax}':y='(ih-ih/zoom)*{ay}':s={W}x{H},format=yuv420p")
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(png), '-vf', vf, '-t', f"{s['dur']}",
         '-c:v', 'libx264', '-preset', 'veryfast' if DRAFT else 'medium', '-crf', '20', str(out)])
    stamp_p.write_text(stamp)
    return out

print(f'• {len(shots)} shots, {TOTAL:.1f}s total ({"real voiceover" if have_vo else "estimated pacing — no voiceover clips yet"})')
clips = []
for s in shots:
    clips.append(render_shot(s))
    print(f"  {s['id']}  {s['start']:6.1f}s  {s['dur']:5.1f}s  {s.get('card') or s['frame']:<36} {s['text'][:50]}")

# ---------------------------------------------------------------- assemble: xfade + corner text + audio
inputs = []
for c in clips: inputs += ['-i', str(c)]
fc = []
prev = '[0:v]'
for i in range(1, len(clips)):
    off = shots[i]['start']
    cur = f'[v{i}]'
    fc.append(f"{prev}[{i}:v]xfade=transition=fade:duration={XFADE}:offset={off:.3f}{cur}")
    prev = cur
card_end = shots[0]['dur'] if shots[0].get('card') else 0
corner = spec['disclaimer_corner'].replace("'", r"\'").replace(':', r'\:')
fs = round(22 * W / 1920)
fc.append(f"{prev}drawtext=fontfile={FONT}:text='{corner}':fontsize={fs}:fontcolor=0x7a7772"
          f":x=w-tw-{round(40*W/1920)}:y=h-th-{round(26*W/1920)}:enable='gte(t,{card_end:.2f})'[vout]")

audio_args = []
if have_vo:
    n0 = len(clips)
    inputs += ['-f', 'lavfi', '-t', f'{TOTAL:.2f}', '-i', 'anullsrc=r=44100:cl=stereo']
    mix = [f'[{n0}:a]']
    k = n0 + 1
    for s in shots:
        if not s['vo_path']: continue
        inputs += ['-i', str(s['vo_path'])]
        ms = round(s['start'] * 1000)
        fc.append(f'[{k}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay={ms}|{ms}[a{k}]')
        mix.append(f'[a{k}]'); k += 1
    fc.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    audio_args = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '160k']

run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(fc), '-map', '[vout]', *audio_args,
     '-c:v', 'libx264', '-preset', 'veryfast' if DRAFT else 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
     '-movflags', '+faststart', '-t', f'{TOTAL:.2f}', str(OUT)])
print(f'✓ {OUT.relative_to(ROOT)}  {media_duration(OUT):.1f}s  {OUT.stat().st_size/1e6:.1f} MB')
