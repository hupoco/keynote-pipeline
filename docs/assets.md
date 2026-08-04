# Generating & inserting media

Generated images/videos land in `assets/generated/`. Slides reference them with a path
**relative to `/deck`** (so `assets/generated/x.png` → `../assets/generated/x.png`).

## Generate
```bash
node scripts/gen-image.mjs -p "abstract orange energy field over deep black, cinematic, no text" -o slide-bg.png --aspect 16:9
node scripts/gen-video.mjs -p "slow drifting embers over deep black, subtle glow, seamless loop, no text" -o ambient.mp4 --aspect 16:9
```
Each script prints the exact HTML snippet to paste, and the file it wrote.

## Insert into a slide (`deck/index.html`)

**Framed hero image/video** (sits opposite a headline, e.g. in `.wrap.split`):
```html
<div class="gen-media glow a-pop" style="--d:.3s">
  <img src="../assets/generated/hero.png" alt="">
</div>
```

**Full-bleed ambient background video** — make it the **first child** of the `<section>` so the
slide's real content renders on top, and add a scrim if the headline needs contrast against it.

## Keep it consistent
- Pick ONE art-direction phrase and reuse it as `STYLE_SUFFIX` in `.env` (or pass `--raw` to skip
  it for one generation) — every generated asset should look like it came from the same shoot.
- Verify after inserting: `npm run shots -- --only <n>` then open `assets/shots/slide-0n.png`.

## Ship one portable file
```bash
npm run build:standalone      # → deck/dist/standalone.html
```

## Model ids drift — verify before your first run
Set `IMAGE_MODEL` / `VIDEO_MODEL` in `.env`. Model ids for Imagen, Gemini native image, and Veo
change over time — check https://ai.google.dev/gemini-api/docs before your first generation.

---

## Generating VIDEO — read this before you spend a roll

These rules came out of a production run of this same pipeline and are worth having before you
burn API calls re-learning them.

### The rule that decides whether a clip survives
> **Fine-motor assembly breaks physics. Walking and observing concepts survive.**
> **Nothing handled, nothing assembled, nothing entering or leaving frame.**

Veo (and similar video models) cannot keep a small object coherent while a hand manipulates it —
ask for it and you get parts materializing and vanishing, tools that empty between frames, hands
that morph. It's not subtle and it doesn't get better by re-rolling.

**Invert the ask instead of fighting the model:**
- Want to show something being assembled/built? Show it **already complete and running**, and
  move the **camera** instead — a lateral dolly, a slow push-in.
- Want to show interaction with an object? Have the subject **walk past or observe** it rather
  than handle it.

Camera moves that reliably work: locked-off with a slow push · steadicam tracking behind someone
walking · one continuous push-in resolving on a turn to camera · lateral macro dolly.

### Write the person into the prompt
Your `STYLE_SUFFIX` carries no casting instruction by default. If you don't specify age/gender/
ethnicity explicitly, the model defaults to a narrow demographic and repeats it across generations.
If casting matters to your brand, state it — and cast across your whole asset set at once, not one
clip in isolation, or you'll get near-identical subjects across supposedly different people.

### Never make a FORMAT the subject
Writing "shot on 35mm film" in a prompt can make the model render a literal **filmstrip** —
sprocket holes, edge codes, a letterboxed frame. **Negating it doesn't work** ("no sprocket holes")
— naming a thing to exclude still names it as a subject. Drop the format-as-subject phrase entirely
and keep only *look* words ("film grain", "filmic color grade").

### Check a new clip against your existing set, numerically
Sample a few frames and compare mean luminance / saturation / hue against clips you've already
wired in, so a new addition doesn't visibly clash. Build this table as you go — there's no
universal reference, only internal consistency with your own asset set.

### Always contact-sheet before wiring a clip in
```bash
ffmpeg -i clip.mp4 -vf "fps=4,scale=440:-1,tile=5x5" sheet.png
```
Then look at every frame. A clip can pass a glance and fail the sheet.
