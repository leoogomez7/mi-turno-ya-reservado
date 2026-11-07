export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Mi Turno Ya Reservado</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="4" />
    <style>
      * { box-sizing: border-box; }
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #101010; color: #f5f5f5; display: grid; place-items: center; min-height: 100vh; margin: 0; overflow: hidden; }
      .loader { position: relative; display: grid; place-items: center; width: 100%; min-height: 100vh; overflow: hidden; isolation: isolate; background: radial-gradient(ellipse at 50% 38%, rgba(196, 146, 44, .12), transparent 38%), radial-gradient(ellipse at 50% 100%, #202020, transparent 55%), #101010; }
      .loader::before, .loader::after { position: absolute; z-index: -1; width: min(78vw, 40rem); aspect-ratio: 1; border: 1px solid rgba(226, 180, 75, .12); border-radius: 50%; content: ""; animation: spin 18s linear infinite; }
      .loader::after { width: min(58vw, 30rem); border-style: dashed; opacity: .7; animation-direction: reverse; animation-duration: 28s; }
      .glow { position: absolute; z-index: -1; width: min(74vw, 32rem); aspect-ratio: 1; border-radius: 50%; background: rgba(226, 180, 75, .12); filter: blur(85px); animation: glow 3.8s ease-in-out infinite; }
      .content { display: flex; width: min(100% - 2rem, 28rem); flex-direction: column; align-items: center; padding: 3rem 1.5rem; text-align: center; animation: enter 700ms ease both; }
      .mark { position: relative; display: grid; width: 10rem; aspect-ratio: 1; margin-bottom: 1.6rem; place-items: center; animation: float 3.6s ease-in-out infinite; }
      .orbit { position: absolute; inset: .35rem; border: 1px solid rgba(226, 180, 75, .45); border-radius: 50%; animation: spin 8s linear infinite; }
      .orbit::after { position: absolute; top: 13%; left: 17%; width: .42rem; aspect-ratio: 1; border-radius: 50%; background: #f1c75b; box-shadow: 0 0 16px rgba(226, 180, 75, .85); content: ""; }
      .orbit.inner { inset: .95rem; border-color: rgba(226, 180, 75, .25); animation-direction: reverse; animation-duration: 12s; }
      .logo-wrap { display: grid; width: 7.8rem; aspect-ratio: 1; overflow: hidden; place-items: center; border: 1px solid rgba(226, 180, 75, .5); border-radius: 50%; background: #111; box-shadow: 0 0 0 .5rem rgba(226, 180, 75, .07), 0 18px 60px -15px rgba(226, 180, 75, .35); }
      .logo { width: 100%; height: 100%; object-fit: cover; animation: pulse 2.8s ease-in-out infinite; }
      .brand { margin: 0; font-size: 1.15rem; font-weight: 600; letter-spacing: -.025em; }
      .status { display: inline-flex; min-height: 2.4rem; align-items: center; gap: .25rem; margin-top: .85rem; color: #e2b44b; font-size: 1.35rem; font-weight: 600; letter-spacing: .04em; }
      .dots { display: inline-flex; gap: .24rem; padding-top: .6rem; }
      .dots i { width: .27rem; height: .27rem; border-radius: 50%; background: #e2b44b; animation: dot 1.15s ease-in-out infinite; }
      .dots i:nth-child(2) { animation-delay: 150ms; } .dots i:nth-child(3) { animation-delay: 300ms; }
      .message { margin: .4rem 0 0; color: #aaa; font-size: .9rem; }
      .footer { position: absolute; bottom: max(1.25rem, env(safe-area-inset-bottom)); color: #777; font-size: .7rem; letter-spacing: .22em; text-transform: uppercase; }
      @keyframes spin { to { transform: rotate(360deg); } } @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
      @keyframes glow { 0%, 100% { opacity: .52; scale: .92; } 50% { opacity: .9; scale: 1.08; } } @keyframes pulse { 0%, 100% { transform: scale(.96); } 50% { transform: scale(1); } }
      @keyframes dot { 0%, 60%, 100% { opacity: .28; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-4px); } } @keyframes enter { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
    </style>
  </head>
  <body>
    <main class="loader" role="status" aria-live="polite" aria-busy="true">
      <div class="glow" aria-hidden="true"></div>
      <div class="content">
        <div class="mark" aria-hidden="true"><span class="orbit"></span><span class="orbit inner"></span><span class="logo-wrap"><img class="logo" src="/logo.png" alt="" /></span></div>
        <p class="brand">Mi Turno Ya Reservado</p>
        <div class="status">Cargando<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
        <p class="message">Estamos preparando todo para vos</p>
      </div>
      <span class="footer">Un buen turno empieza acá</span>
    </main>
    <script>setTimeout(() => location.reload(), 4000);</script>
  </body>
</html>`;
}
