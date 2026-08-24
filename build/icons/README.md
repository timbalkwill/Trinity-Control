# Trinity Control application icons

This directory contains the officially approved Trinity emblem for the Trinity
Control application icon. The existing horizontal church wordmark remains
untouched and is not cropped, redrawn, or stretched into an application icon.

`trinity-control.png` is the canonical square source used at runtime. The source
artwork's connected white corner canvas is made transparent during import; its
approved emblem, gradients, dark rounded-square background, proportions, and
crop are otherwise unchanged.

Regenerate all assets on macOS with the bundled/Pillow-enabled Python runtime:

```sh
python3 build/generate-icons.py /path/to/approved-square-source.png
```

Omit the source argument to rebuild platform formats from the canonical PNG.
The generator creates:

- `png/16.png`
- `png/32.png`
- `png/48.png`
- `png/64.png`
- `png/128.png`
- `png/256.png`
- `png/512.png`
- `png/1024.png`
- `trinity-control.icns`
- `trinity-control.ico`
