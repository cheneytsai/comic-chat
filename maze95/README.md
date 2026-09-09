# Maze 95

A full-screen web recreation of the Windows 95 **3D Maze** screensaver — playable,
customizable, freshly generated on every load, and drivable by a browser agent
through [WebMCP](https://github.com/webmachinelearning/webmcp).

Open `index.html`. That's the whole project: one file, no build step, no dependencies.

## Why it isn't a port

The demo at [maze95.js.org](https://maze95.js.org/) is built on
[maze95/maze95-js](https://github.com/maze95/maze95-js) (three.js), which was archived in
November 2023 with **no license**, and its wall art comes from Microsoft's original
screensaver. Neither is redistributable, so nothing here is copied from either. The maze
generator, the WebGL renderer, and every texture in this page are written from scratch;
the textures are drawn procedurally into a canvas at load time, so the repository ships
no image assets at all.

## What's in it

**Renderer** — a ~200 line WebGL layer: one shader, interleaved position/UV/brightness
vertices, per-face shading, and squared distance fog that gives the corridors the
torch-lit falloff the original had. Walls, floor, ceiling, plaques and the exit portal
are separate batches; the drifting polyhedra are rebuilt into a dynamic buffer each frame.

**Maze** — recursive backtracker over an `W × H` grid, optionally *braided* (a share of
dead ends knocked through) so corridors form loops. Start and exit are the two furthest
apart cells, found with two breadth-first sweeps.

**Four ways to move**
- *Screensaver* — the left-hand wall follower, turning and gliding cell to cell like the 1995 original.
- *Player* — `W A S D` / arrows, `Shift` to run, mouse look under pointer lock, `Esc` to hand it back. Touch gets a thumbstick and drag-to-look.
- *Agent* — tool calls walk the camera along a path and resolve when the walk finishes.
- Idle for the configured number of seconds and the screensaver takes over again, exactly like the real thing.

**Customizable** — grid size, loop density, five wall styles, torch range, field of view,
wall height, render scale, walk speed, mouse sensitivity, scanlines, head bob, map
reveal, and the idle timeout. Settings persist in `localStorage`; the maze seed
deliberately does not, so every load is a new maze. `?seed=ABC123` reproduces one.

## Agent tools

Registered with `navigator.modelContext.registerTool()` where the browser has it
(Chrome 146+), falling back to `provideContext()`. Agents without WebMCP can call
`window.maze95.call(name, args)` or post `{type:"maze95:call", tool, args}` to the frame.
Every call is echoed in the on-screen log.

| Tool | Does |
| --- | --- |
| `maze_get_state` | Seed, grid size, current cell, heading, which sides are open, steps to the exit |
| `maze_look` | Corridor length ahead, side openings along it, whether the exit is in view |
| `maze_get_map` | ASCII floor plan — `@` player, `S` start, `X` exit, `?` unexplored |
| `maze_move` | Walk whole cells relative to the heading; stops at walls and says so |
| `maze_turn` | Quarter turns, or an absolute compass heading |
| `maze_goto` | Shortest route to any cell |
| `maze_solve` | Shortest route to the exit |
| `maze_new_maze` | Regenerate, optionally with a size or a seed |
| `maze_set_options` | Wall style, torch range, FOV, wall height, speed, loops, overlays |
| `maze_set_driver` | Hand the camera to the screensaver, the agent, or the player |

Because `maze_look` and `maze_get_map` return the layout as text, an agent can solve the
maze without ever looking at a pixel.

## Keys

| | |
| --- | --- |
| `W A S D` / arrows | Move (arrows left/right turn) |
| Mouse | Look, after clicking to lock the pointer |
| `Shift` | Run |
| `N` | New maze |
| `Esc` | Back to the screensaver |
