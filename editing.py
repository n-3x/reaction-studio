"""Local, non-destructive clip assembly. Source files and generation state are preserved."""
import math
from pathlib import Path
import hook


def number(value, name, low=0, high=None):
    try:
        value = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"Choose a valid {name}.") from None
    if not math.isfinite(value) or value < low or (high is not None and value > high):
        raise ValueError(f"Choose a valid {name}.")
    return value


def render(clips, output, *, soundtrack=None, audio_mode="reel", audio_gain=1,
           audio_start=0, keep_full_audio=True):
    if not clips:
        raise ValueError("Add at least one clip to the sequence.")
    total = sum((clip["end_frame"] - clip["start_frame"]) / 30 for clip in clips)
    reel = soundtrack and audio_mode in ("reel", "mix")
    audio_duration = hook.audio_seconds(soundtrack) if reel else 0
    if reel and audio_start >= audio_duration:
        raise ValueError("The soundtrack start is past the end of the reel audio.")
    if reel and keep_full_audio and total + 0.04 < audio_duration - audio_start:
        raise ValueError(f"Add {audio_duration - audio_start - total:.2f}s of footage to cover the full reel audio, or turn off Keep full soundtrack.")
    inputs, filters = [], []
    clip_audio = audio_mode in ("clips", "mix")
    for index, clip in enumerate(clips):
        inputs += ["-i", clip["path"]]
        start, end = clip["start_frame"] / 30, clip["end_frame"] / 30
        duration = end - start
        filters.append(f"[{index}:v:0]fps=30,trim=start_frame={clip['start_frame']}:end_frame={clip['end_frame']},"
                       "setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,"
                       f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,settb=AVTB[v{index}]")
        if clip_audio:
            has_audio = any(s["codec_type"] == "audio" for s in hook.probe(clip["path"])["streams"])
            audio = (f"[{index}:a:0]atrim=start={start:.9f}:end={end:.9f},asetpts=PTS-STARTPTS,"
                     f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={clip['volume']},apad"
                     if has_audio else "anullsrc=r=48000:cl=stereo")
            filters.append(f"{audio},atrim=duration={duration:.9f},asetpts=PTS-STARTPTS[a{index}]")
    labels = "".join(f"[v{i}]" + (f"[a{i}]" if clip_audio else "") for i in range(len(clips)))
    filters.append(f"{labels}concat=n={len(clips)}:v=1:a={int(clip_audio)}[v]" + ("[clipaudio]" if clip_audio else ""))
    mapping = ["-map", "[v]"]
    if reel:
        inputs += ["-i", soundtrack]
        filters.append(f"[{len(clips)}:a:0]atrim=start={audio_start},asetpts=PTS-STARTPTS,aresample=48000,"
                       f"aformat=sample_fmts=fltp:channel_layouts=stereo,volume={audio_gain},apad,atrim=duration={total:.9f}[reel]")
        if clip_audio:
            filters.append("[clipaudio][reel]amix=inputs=2:normalize=0:dropout_transition=0[a]")
            mapping += ["-map", "[a]"]
        else:
            mapping += ["-map", "[reel]"]
    elif clip_audio:
        mapping += ["-map", "[clipaudio]"]
    else:
        mapping += ["-an"]
    output = Path(output)
    partial = output.with_name(output.stem + ".partial.mp4")
    hook.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filters), *mapping,
              "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", partial])
    if not hook.valid_video(partial, total):
        raise ValueError("The stitched video did not pass duration/decoding verification. Your source clips are unchanged.")
    partial.replace(output)
    report = {"output_seconds": hook.seconds(output), "width": 1080, "height": 1920, "fps": 30,
              "audio_mode": audio_mode, "audio_gain": audio_gain, "audio_start": audio_start,
              "full_soundtrack_preserved": bool(reel and total + 0.04 >= audio_duration - audio_start),
              "video_freeze_added": False, "clips": [{k: v for k, v in c.items() if k != "path"} for c in clips]}
    hook.save(output.with_suffix(".json"), report)
    return report
