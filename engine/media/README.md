# engine/media — served at http://localhost:8788/media/

The committed files here make the demo self-contained. Big Buck Bunny is
© the Blender Foundation, **CC BY 3.0** — https://peach.blender.org. Thank you, Peach!

- `bbb_fmp4_60s.mp4` — the first 60 s of Big Buck Bunny, remuxed to fragmented
  MP4 (`-movflags frag_keyframe+empty_moov+default_base_moof`) for the MSE
  pipeline. This is what a fresh clone serves out of the box.
- `big-buck-bunny.srt` — caption track (synced to this timeline).

## Want the full ~10-minute movie?

Fetch the source from archive.org and remux (no re-encode):

```bash
curl -Lo big_buck_bunny_720p.mp4 \
  "https://archive.org/download/BigBuckBunny_124/big_buck_bunny_720p_surround.mp4"
ffmpeg -i big_buck_bunny_720p.mp4 -c copy \
  -movflags frag_keyframe+empty_moov+default_base_moof bbb_fmp4_full.mp4
```

The app prefers `bbb_fmp4_full.mp4` when present and falls back to the 60 s clip.
