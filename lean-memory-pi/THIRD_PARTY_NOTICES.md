# Third-party attribution

## pi-memory 0.4.2

- Author: **Jay Zeng** (jayzeng)
- Source: https://github.com/jayzeng/pi-memory
- Package: https://www.npmjs.com/package/pi-memory
- License: MIT

Lean Memory 0.1 was a thin context-injection adapter over the complete pi-memory
runtime. Version 0.2 adds its own project-scoped storage, seven tool definitions,
local keyword search, recovery records and snapshot lifecycle to enforce isolation.
It reuses pi-memory's `parseScratchpad`, `serializeScratchpad`, `scratchpadAdd`,
`scratchpadToggle`, `scratchpadClearDone` and `forgetBlocks` helpers unchanged.
Those helpers preserve free-form notes and implement entry-aware deletion; credit
for them belongs to Jay Zeng. The familiar tool names and Markdown organization
also originate from pi-memory.

The unchanged upstream package is bundled as a pinned dependency for these helpers;
its global extension factory and qmd integration are not invoked. Its original
copyright and license remain intact. No upstream endorsement is implied.

Upstream pi-memory also credits https://github.com/skyfallsin/pi-mem for inspiration.

### Original pi-memory license

MIT License

Copyright (c) 2026 Jay Zeng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
