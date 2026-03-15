export function AboutPage() {
  return <div id="about-page">
    <h1>About the author</h1>
    <p>
      ¡Qué pasa, gente! My name is Guillermo, aka Guimotron as per
      my <a href="https://www.youtube.com/@guimotron">
        <img className="img-inline" src="/svg/youtube.svg" alt=""></img>
        Youtube channel
      </a>.
      In late 2024, I embarked on a journey to reach 2000 rating on Lichess,
      recording -almost all of- my games and uploading them to my channel.
      The journey concluded (successfully!) on early 2026.
    </p>

    <p>
      If you find the tool useful, want to support me, or why not,
      both of those things, feel free
      to <a href="https://buymeacoffee.com/guimotron">
        buy me a coffee
      </a>!
      Support is always appreciated but never needed.
    </p>

    <img className="img-author" src="/img/guimotron.jpeg" alt=""></img>

    <h1>About ChessLab</h1>
    <p>
      An app built to offer custom functionality that I found lacking
      in other applications.
    </p>
    <p>
      It does not aim to be production-level code.
      Rather, I took the opportunity to play around and learn about
      frontend and agentic-coding technologies, while developing
      something useful for myself and hopefully for others too!
    </p>

    <h2>Opening training</h2>

    <p>
      A tool that allows the user to drill opening lines by loading
      them from a Lichess study.
      By default it will show the ones I use, so hopefully I learn
      something about them!
    </p>

    <p>
      Note one can also supply a lichess study URL and all the lines
      from the study will be loaded.
    </p>
  </div>;
}
