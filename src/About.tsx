export function AboutPage() {
  return <div id="about-page">
    <img className="img-centered" src={`${import.meta.env.BASE_URL}img/chesslab-banner.png`} alt=""></img>

    <h1>About the app</h1>
    <p>
      Welcome to ChessLab, a completely free app offering different
      chess-related tools that crossed my mind at some point!

      Source code can be found in <a href="https://github.com/Flood1993/chesslab">Github</a>.
    </p>

    <ul>
      <li>
        <b>Opening training</b>:
        Train opening lines by repetition!
        By default it will load the ones I use, but it is also possible to
        load them from a Lichess study.
      </li>
      <li>
        <b>Review game</b>:
        A basic analysis board, with live evaluation from Stockfish 18.
        I added it mostly to experiment with the Stockfish library,
        the evaluation gauge, and the move list.
      </li>
      <li>
        <b>Review mistakes</b>:
        Loads a PGN file with pre-computed analysis of the games and
        gives a comprehensive view about the player blunders.
        Click any entry to jump to the position and try to figure what
        went wrong!
      </li>
      <li>
        <b>Eval battle</b>:
        Pick a game from the list, choose a color and see how your moves
        compare to those played in the real game!
      </li>
    </ul>

    <p>
      Please reach out to me with any feedback or suggestions you may have!
    </p>

    <h1>About the author</h1>
    <p>
      ¡Qué pasa, gente! My name is Guillermo, aka Guimotron as per
      my <a href="https://www.youtube.com/@guimotron">
        <img className="img-inline" src={`${import.meta.env.BASE_URL}svg/youtube.svg`} alt=""></img>
        Youtube channel
      </a>.
      In late 2024, I embarked on a journey to reach 2000 rating on Lichess,
      recording -almost all of- my games and uploading them to my channel.
      The journey concluded (successfully!) on early 2026.
    </p>

    <p>
      Ideas for different tools crossed my mind throughout this journey,
      so at some point I decided to start implementing them even if only
      for personal use and the learning experience.
    </p>

    <p>
      If you find the tool useful, want to support me, or why not,
      both, feel free
      to <a href="https://buymeacoffee.com/guimotron">
        buy me a coffee
      </a>!
      Support is always appreciated but never needed.
    </p>

    <img className="img-centered" src={`${import.meta.env.BASE_URL}img/guimotron.jpeg`} alt=""></img>

  </div>;
}
