# Reaction Studio

Turn any reaction reel into a three-second AI hook with your own model, using your own fal/AIMLAPI key and your own ChatGPT account. Runs locally; nothing is hosted.

## Self-host it (free, bring your own keys)

Each person runs their own copy, so nobody shares keys or accounts and there is nothing to host or pay for.

1. Install `python3`, `ffmpeg` and `yt-dlp` (macOS: `brew install python ffmpeg yt-dlp`). Optional: `npm i -g @openai/codex` for automatic starting images.
2. Get the code (clone or download this folder) and run `./start.sh`, then open http://127.0.0.1:8787.
3. In the app, open **Connections** (bottom of the sidebar), paste your own fal or AIMLAPI key (or put it in `.env`), then **Connect ChatGPT account** to sign in with your own ChatGPT account.
4. Add your own model photos with **Add** next to the model picker.

Keys, ChatGPT sign-in, projects and media stay on your machine (`.env`, `.local/`, `runs/`, `profiles/`, `assets/` are git-ignored). The server binds to `127.0.0.1` only and has no login, so do not expose it to the internet.

## Open the web interface

From this folder, run:

```sh
python3 app.py
```

Or double-click `Start Content Tool.command`. Open [Content Tool](http://127.0.0.1:8787). The server binds only to this Mac, and saves job history and media in this workspace. Keep the server running while a video is processing.

The editor is organized around **Reference → Starting image → Motion → Edit → Assets**. Projects stay in the left sidebar, the preview occupies the center, and the right panel shows controls for the selected step. There is one primary action. Trim/timing, image tools, activity and export settings expand when needed. Individual asset downloads live in the preview’s download menu. Project titles save on blur; duplicate and archive/restore live in the project menu.

1. Select a saved model, upload a reference or paste an Instagram URL, then **Prepare reference**. Defaults select the first three seconds at original speed.
2. Play the trimmed hook or switch to the full source reel. Expand **Trim & timing** to edit the selection, use the source playhead, or explicitly slow a short selection. Applying edits creates a revision.
3. Approve the reference to create the starting image. Review identity, pose and hands. **Image tools** offers recreation, replacement upload, the image prompt and reference frame.
4. Continue from image review to **Motion**, then edit the **Video prompt** before selecting **Generate motion**. The prompt saves automatically and is included in the actual Kling request. It is locked after submission; revisions inherit it for editing. Earlier steps remain accessible during generation.
5. Review the result. **Compare** shows the exact input beside it. **Playback controls** provides frame stepping and review speed. Continue to **Edit** to assemble the final video.
6. Add saved reactions or uploaded videos to the sequence. Drag clips to reorder; drag their edges or enter numeric in/out points to trim. The playhead supports seeking, frame stepping and splitting. Move, remove, undo and redo stay local to the edit; originals are preserved. Edits autosave, and stale saves from another window are rejected.
7. Choose original reel audio, clip audio, a mix, or silence. **Keep full soundtrack** is on by default: add enough footage to cover the audio, or explicitly turn it off to trim audio to the sequence. Export the final video locally at 1080×1920, 30 fps, without adding a frozen tail. A live sequence preview and the last rendered final are selectable separately.
8. **Assets** still exports the project ZIP: a three-second `hook.mp4`, **the entire reel soundtrack** as `soundtrack.m4a`, and timing metadata in `project.json`. The hook defaults to silent; adding an audio excerpt is optional in export settings. The full soundtrack remains separate in either case. Assets remain separate in the ZIP; the Edit step is where you intentionally stitch the final video. No video freeze is added to fill audio duration.

The audio player and project track keep the complete original reel audio, starting at 0:00, independently of the hook’s trim. Soundtrack volume applies to the entire exported audio file; the unmodified full track remains downloadable separately. A missing source audio track is explicitly shown. Mute is volume 0; the timeline preview caps boosts at 100%, while export supports up to 200%.

A result such as **2.933s** opens for review instead of failing. Explicit full-clip retiming makes it three seconds without a frozen tail. This corrects duration, not motion artifacts. A new revision lets you adjust the inputs before another paid attempt. Resume checks the existing request.

New references retain original speed; short selections stay visibly short and cannot be approved until you choose a longer section or explicitly slow them. Cut detection warns without changing the selected length. Prefer three real seconds from one continuous shot.

The reference preview also has a visual trim range with draggable in/out handles and a draggable selection. Set in/out from the source playhead, then apply the trim as a new revision. Generation input remains limited to three seconds. Final sequence clips can use their full length.

All earlier controls remain available through their relevant step or menu. The original two-clip stitch command remains available through the CLI. Native automatic images still use the signed-in Codex CLI, with manual ChatGPT upload as an alternative.

For fal generation, configure `FAL_KEY` in the environment used to launch the server, or copy `.env.example` to `.env` and enter the key there. The app rereads the workspace `.env` so it can detect the key without a restart. You may also save a key in the local Settings dialog. Keys stay server-side and are excluded from Git. Never paste keys in chat.

When generation completes, the app downloads the raw result for review. Explicit export creates a verified three-second hook and keeps the full reel soundtrack as a separate asset in **Download project**. Resume a pending/interrupted job to continue the recorded request. Avoid making a new job to recover an existing fal request. A request with an uncertain submission response needs its fal request history checked before retrying.

Browser previews have not been launched. The local HTTP smoke check covers static delivery, actual uploads, native image-worker status, media seeking responses, private-file rejection, and request dry run:

```sh
python3 scripts/check_web.py
```

The sections below document the underlying CLI and both image paths.

Create a three-second reaction with a saved influencer identity, using ChatGPT/Codex for the starting image and fal.ai Kling 3.0 Standard Motion Control for video. Append an already finished demo after the hook using local stitching.

The local web interface and command-line tools share the same preparation and fal pipeline. They do not call a paid image API or automate the ChatGPT website. Native image generation has now been verified from the background Codex CLI worker on this installation.

## Interface and frontend build

The studio is a React 18 app (zustand state, Radix UI primitives, lucide icons) bundled with esbuild into `web/dist/` and served by the Python server — no runtime CDN or Node server. The committed bundle is ready to use; Node is only needed to rebuild after editing `frontend/`:

```sh
npm ci --ignore-scripts --no-bin-links
npm run build        # or: npm run watch
```

Highlights: a stepper with live status, dark/light themes, custom player controls (frame step, speed, fullscreen, compare), a trim selector over a real filmstrip of the source reel, and a full edit timeline — filmstrip clips, soundtrack waveform, ruler, draggable playhead, snapping, drag-to-reorder, edge trimming, split/duplicate/delete, zoom (⌘/Ctrl + scroll), autosave with undo/redo. Press `?` for shortcuts: Space play, ← → frame, ↑ ↓ cut points, S split, ⌫ delete, ⌘Z undo, N snapping, +/−/0 zoom. The previous vanilla frontend is backed up in `.legacy-frontend/`.

## Connect a ChatGPT account (including free accounts)

Open **Connections → Connect ChatGPT account**. The app runs the official `codex login --device-auth` flow into its own folder (`.local/chatgpt-home`); you approve a one-time code on openai.com. The app never reads your password or tokens. You can disconnect there, or choose between this connection and the Codex sign-in already on the Mac.

Free accounts can connect, but whether *automatic* image creation is included depends on the plan and its limits, and that has not been verified against a free account. If automatic creation is unavailable or out of allowance, the error says so and the Starting image step offers a guided **ChatGPT website** flow that works on free accounts: download a reference pack (model photos, reference frame, prompt), make the image in chatgpt.com, then drop or paste (⌘V) the result back.

## Stack and recommendation

Start with **Python standard library + FFmpeg/ffprobe + yt-dlp + Codex native image generation + fal queue API**. These command-line tools are already installed on this Mac. No package installation, server, browser preview, GPU, or hosting is needed for the prototype. JSON manifests preserve each job and its fal request ID; introduce SQLite and a small UI when multiple users or simultaneous workers justify them.

Python is the smallest initial implementation here because media work runs in FFmpeg and downloading runs in yt-dlp. A TypeScript app with `@fal-ai/client` and the Codex SDK is a reasonable later interface, but does not itself make the subscription image tool available in a background worker.

## Save the influencer once

```sh
python3 hook.py profile main "/absolute/path/front.jpg" "/absolute/path/three-quarter.jpg"
```

Use clear identity photos. Optional `--notes` can specify details such as retaining the influencer's clothing. Otherwise the recreation prompt follows clothing in the reference frame. Profiles and run artifacts stay in this workspace and are ignored by Git. No ChatGPT or Instagram login credentials are stored by this program.

## Path A: automated inside Codex — preferred

Give Codex this instruction after saving the profile:

> Follow WORKFLOW.md. Make a reaction hook from this URL with profile main. Use your native image generation tool for the recreated starting image, then submit it to fal and save the finished hook. Keep image generation on my ChatGPT subscription. Reference: [paste URL].

Codex runs the preparation script, loads the saved identity images and extracted first frame, creates the starting image, attaches it to the job, submits the fal request, and retrieves the result. This needs native image generation in that Codex session and `FAL_KEY` set locally. A local script cannot directly invoke the image tool offered by this chat.

Current official documentation describes built-in image generation within Codex usage limits, including editing with reference images. It is still necessary to compare this route with your existing ChatGPT results for identity and composition. It is not a promise of identical outputs or unlimited subscription usage. [OpenAI image-generation documentation](https://learn.chatgpt.com/docs/image-generation), [usage accounting](https://learn.chatgpt.com/docs/pricing).

## Path B: manual ChatGPT image, automated preparation and video

```sh
python3 hook.py prepare "https://www.instagram.com/p/DfEs08Gxtdv/" --profile main
```

The printed job folder contains `first-frame.png`, `reference.mp4`, `image-prompt.txt`, and `job.json`. In ChatGPT, attach the saved profile images and `first-frame.png`, paste the image prompt, and save the recreated image. Then:

```sh
python3 hook.py attach "/absolute/path/to/job" "/absolute/path/recreated.png"
python3 hook.py submit "/absolute/path/to/job"
python3 hook.py status "/absolute/path/to/job" --download
```

`submit` is a paid video-generation call. Set `FAL_KEY` in your local environment; never paste the key into chat. `status` checks the existing request. Run it again later if generation is still queued or in progress. A completed request is downloaded as `generated.mp4` for review; it is not automatically retimed or padded. After reviewing it, export with original reel audio:

```sh
python3 hook.py finish "/absolute/path/to/job"
# Only after reviewing and choosing speed correction for a short result:
python3 hook.py finish "/absolute/path/to/job" --retime
```

The export creates `project.zip` with a three-second, 30 fps H.264 `hook.mp4`, the entire `soundtrack.m4a` from source time zero, and `project.json`. The hook MP4 defaults to silent. `--include-hook-audio` also adds an excerpt at the selected trim time to that MP4, while keeping the complete soundtrack separate. Use `--audio-gain 0` to mute or a value up to `2` to boost the full exported soundtrack. `--retime` spreads the entire short motion over three seconds without adding a freeze. Raw generation and the original source remain intact.

Both paths share every operation except how the recreated starting image is supplied.

## Check without spending fal credits

After attaching the starting image:

```sh
python3 hook.py submit "/absolute/path/to/job" --dry-run
```

This checks the local image and video inputs and writes `request-check.json`. It does not upload files, call the network, require a fal key, create a submission lock, or submit a generation. It verifies local preparation, not remote model acceptance or quality.

## Append the finished demo

The demo is already created content that starts immediately after the three-second hook. It is not a generation reference. To assemble an existing hook and demo:

```sh
python3 hook.py stitch "/absolute/path/hook.mp4" "/absolute/path/demo.mp4" --output "/absolute/path/final.mp4"
```

This is local FFmpeg processing. It creates a 1080×1920, 30 fps MP4, fitting both clips without cropping, and retains their audio. A clip without audio receives silence. The demo starts at exactly 3.000 seconds. At most one frame of last-frame hold aligns the complete demo to the export frame grid. Output files are never overwritten. Existing demo captions and content remain part of the demo.

The clean starting image deliberately excludes the reference's social caption and emoji overlay, which would otherwise risk becoming distorted during animation. Adding a hook caption is a separate finishing choice; the stitch command does not add or rewrite captions.

## Downloading and reaction duration

Instagram links use the project-local yt-dlp, then Instaloader for supported public posts if yt-dlp fails. Instagram can still block either extractor or require login. Use a downloaded MP4 as input when both fail:

```sh
python3 hook.py prepare "/absolute/path/reference.mp4" --profile main
```

If you choose to let yt-dlp use an existing signed-in browser session, explicitly pass `--cookies-from-browser chrome` or the appropriate browser. This uses yt-dlp's supported cookie option; it does not open a browser. Instagram downloading remains dependent on access and extractor compatibility. [yt-dlp authentication guidance](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp).

To install or refresh the project-local downloaders, run `python3 -m pip install --upgrade --target .local/downloader yt-dlp instaloader`. The app never reads browser cookies unless explicitly requested through the CLI.

Preparation checks the selected interval for a possible hard cut using FFmpeg scene-change scoring. It reports the cut time without changing the selection. This is a heuristic: inspect the playable reference before approving.

Short selections default to original speed and remain short. `--short-mode slow` explicitly retimes them to three seconds; frame duplication does not recover missing motion. The legacy CLI `--short-mode hold` still exists for old workflows, but the web app offers original speed or explicit slowing. Prefer three real seconds from one continuous shot. File duration alone cannot establish model compatibility or output quality.

Source footage is fitted into a 720×1280 reference canvas without cutting off the subject. Nonvertical footage gets padding and a warning; intentional reframing should precede generation if that padding is unsuitable. The starting image must already be 9:16. The first frame is extracted after preparation, so it corresponds to the actual motion input.

## fal settings, cost, and reliability

- Endpoint: `fal-ai/kling-video/v3/standard/motion-control`, matching your playground.
- Default: `character_orientation="video"` for performance transfer. `--orientation image` is available for comparison when camera movement or image orientation matters.
- `keep_original_sound=false`; handle reference audio separately once timing is decided.
- The API also offers facial element binding with video orientation. It is a later identity-preservation experiment; the prototype does not submit elements yet. [Exact model schema](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control/api).

fal lists Standard at **$0.126 per generated second** and Pro at **$0.168**. An exactly three-second output therefore estimates to **$0.378 Standard** or **$0.504 Pro**, before taxes, retries, or any account-specific changes. Keep Standard as the baseline; Pro adds about 12.6 cents per attempt and should earn that difference in a comparison. These are listed rates, not a live quote for your account. [fal pricing](https://fal.ai/kling-motion-control).

The script uploads the image and motion reference to fal storage using the official Python client, then submits their URLs. Install the project-local client with `python3 -m pip install --target .local/fal 'fal-client>=1.0.2,<2'` if needed. It records the returned queue URLs and request ID and does not automatically repeat a submission. A submission lock protects against accidental concurrent calls. If a request times out before its ID arrives, the job is marked `submission_unknown`: check fal history before retrying or creating an equivalent job. Polling or downloading an existing request does not intentionally submit another generation. [fal queue documentation](https://fal.ai/docs/documentation/model-apis/inference/queue).

## Plus subscription boundary

Your plan is ChatGPT Plus. Use included native ChatGPT/Codex image generation within its usage limits. The documented API-credit benefit is for eligible Pro and Business subscriptions; Plus is excluded. Therefore the OpenAI Images API would add separate usage costs on your current plan. [API-credit eligibility](https://developers.openai.com/api/docs/guides/chatgpt-api-credits).

The web interface now invokes native image generation through the signed-in Codex CLI and has completed a real image recreation and saved its result. It requires the same signed-in local installation and available subscription usage. If the worker is unavailable on another installation, the UI offers manual starting-image upload rather than silently switching to a paid image API. [Codex automation](https://learn.chatgpt.com/docs/non-interactive-mode).
