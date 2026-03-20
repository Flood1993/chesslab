<div align="center">

![](./public/img/chesslab-banner.png)

**[▶ Open Chesslab. For free!](https://flood1993.github.io/chesslab/)**

</div>

A tool aimed to help people improve at chess!

Under the hood, it uses:

- [chessground](https://github.com/lichess-org/chessground) for the chess UI.
- [chessops](https://github.com/niklasf/chessops) for the chess logic.
- [stockfish.js](https://github.com/nmrugg/stockfish.js/) for engine evalauation.
    In particular, **stockfish-18-lite-single**.

Chesslab does not aim to be production-level code.
Rather, I developed it to learn about frontend and agentic-coding
technologies, while developing something useful for myself and
hopefully for others too!

## Development

**Install dependencies** (requires [pnpm](https://pnpm.io/installation)):

```sh
pnpm install
```

**Run locally:**

```sh
pnpm run dev
```

Then open the URL printed in the terminal (typically `http://localhost:5173/chesslab/`).

**Deploy to GitHub Pages:**

```sh
pnpm run deploy
```

This builds the project and publishes the `dist/` folder to the `gh-pages` branch automatically.
