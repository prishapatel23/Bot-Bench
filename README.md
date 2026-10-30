# BotBench

Build a robot from real parts, wire it to a real board, write Arduino code for it, and watch it drive in a virtual arena. When it fails, BotBench shows where it failed, explains why, and offers a version of your code that works.

The simulator runs entirely in the browser. Accounts are optional: logging in lets you keep many robots, open them on any device and put your times on the challenge boards.

## Run it

```bash
npm install
npm run dev
```

Open the address Vite prints. The account pages work straight away: with no `DATABASE_URL` the dev server keeps a local Postgres (PGlite) in `.data/`, and reset emails are printed in the terminal.

`npm test` runs the engine checks (transpiler, physics, and every example program against its arena). `npm run test:ui` opens the real pages in the Edge or Chrome already installed on your machine and drives a full run, the tour, a share link and dark mode. Set `CHROME_PATH` if it can't find one. `npm run test:api` runs the account routes against an in-memory database, with fake Google and GitHub on the other end.

## Deploy to Vercel

The repo is ready as it is: `vercel.json` tells Vercel to set up the database tables, run `npm run build` and serve `dist`.

1. Push the folder to a GitHub repository.
2. In Vercel, choose **Add New Project** and import that repository. The settings from `vercel.json` fill themselves in.
3. Deploy. The landing page is served at `/` and the workbench at `/studio`.

Accounts need a database and a few environment variables, all listed in `.env.example`:

1. Create a Postgres database. Neon's free tier works; in Vercel, **Storage > Create Database > Neon** adds `DATABASE_URL` for you.
2. Nothing else to do for the tables: every Vercel build runs `npm run db:setup` first, which creates any that are missing. To set them up by hand, put `DATABASE_URL` in a local `.env` and run it yourself.
3. Set `SITE_URL` to the real address.
4. For reset emails, add `RESEND_API_KEY` and `MAIL_FROM` (resend.com, with your domain verified). Without them the link only shows up in the Vercel function logs.

Each sign-in button only shows once its keys are set:

| Provider | Where | Redirect URL to register |
| --- | --- | --- |
| Google | Google Cloud Console > Credentials > OAuth client ID, type Web | `https://YOUR-DOMAIN/api/oauth/google` |
| GitHub | github.com/settings/developers > New OAuth App | `https://YOUR-DOMAIN/api/oauth/github` |
| Apple | Apple Developer > Identifiers > Services ID, plus a Sign in with Apple key (.p8) | `https://YOUR-DOMAIN/api/oauth/apple` |

Apple needs a paid developer account and only redirects to https, so it can't be tried on localhost. Paste the whole .p8 file into `APPLE_PRIVATE_KEY`; `\n` in place of line breaks is fine. For local Google or GitHub testing, register `http://localhost:5173/api/oauth/google` (or `/github`) as a second redirect URL.

The live site is https://bot-bench-gray.vercel.app. If it moves to its own domain, change that address in the `<head>` of `index.html` and `studio.html` so link previews pick up `og.png`.

## Offline

`public/sw.js` is a small hand-written service worker. On the first visit it caches the landing page, the workbench, the built JS/CSS and the Latin font files; after that the site opens without a connection. Built files under `/assets/` are served from the cache, pages go to the network first and fall back to the cache.

`vite build` writes the file list and a build id into `dist/sw.js` (the `offlineShell` plugin in `vite.config.js`), so each deploy gets a new cache and the old one is deleted. The worker is not registered in dev or on localhost, so `npm run dev` and `npm run preview` never serve stale files. Test it on a Vercel preview deploy: load the site once, then turn on offline mode in DevTools and reload.

## How it fits together

```
index.html        landing page
studio.html       the workbench: Robot / Arena / Code & run
src/engine/       no DOM in here, so it also runs under Node for tests
  parts.js        boards, motors, drivers, sensors, chassis, batteries
  arena.js        arena geometry, preset arenas, sensing and collisions
  camera.js       Pixy2 camera: floor picture and line vector
  transpile.js    Arduino C++ subset -> JavaScript generators
  runtime.js      Arduino API (pinMode, analogWrite, pulseIn, Servo, Serial...)
  sim.js          physics loop, run log, failure detection
  coach.js        static checks + reading the run log -> explanations and fixes
  examples.js     generates working code for the robot you actually built
src/studio/       workbench UI
src/landing/      landing page UI
src/account/      log in, sign up and reset password pages
api/              Vercel functions: auth, oauth, projects, bests
server/           what they share: Postgres, sessions, OAuth providers, mail
```

### Accounts

Hand-written, no auth library. Passwords are hashed with Node's built-in `scrypt`. A session is a random token in an `HttpOnly`, `SameSite=Lax` cookie; the database only stores its sha256, so a leaked table can't be used to log in. The API only accepts JSON bodies, which a form on another site can't send, and that covers CSRF. Ten wrong passwords for one email in 15 minutes pauses logins for that email (100 per IP address, since a school can share one). A reset link works once, for an hour, and logs out every other device.

Google, GitHub and Apple use the OAuth authorization code flow with `state` (and PKCE where the provider supports it). An outside sign-in with a verified email that matches an existing account is linked to it.

Challenge times are sent by the browser after a run. The server recomputes the stars from the numbers and keeps your best per arena, but it doesn't re-run the sketch, so a determined cheat could post a fake time.

### Why a transpiler and not a real AVR emulator

Running compiled firmware needs a compiler, which means a server. Arduino sketches are close enough to JavaScript that a careful source transform covers what students write: globals, functions, arrays, `#define`, `Servo`, `NewPing`, integer truncation on `int` variables. `delay()` and user functions become generators so the robot keeps moving while the code waits.

Time is virtual. `analogRead` costs about 112 µs, `Serial.print` at 9600 baud costs about 1 ms per character, `pulseIn` waits for the echo. A slow loop drives badly here for the same reason it drives badly on a real robot.

### Things the simulator models on purpose

- `analogWrite` on a non-PWM pin acts like `digitalWrite` (value < 128 is LOW).
- Pins that are never set to `OUTPUT` do not drive the motor driver.
- L298N drops about 2 V, so 4×AA batteries feel slow.
- TB6612 does nothing until `STBY` is HIGH.
- Very low PWM values do not overcome motor friction.
- Reading a pin with nothing connected returns noise.
- ESP32 `analogRead` goes to 4095, not 1023.
- `pulseIn` with no trigger waits its full timeout.
- A Pixy2 needs `pixy.init()` before it answers, and it takes over the SPI pins (D11, D12, D13 on an Uno).
- Encoders only work on interrupt pins (D2 and D3 on an Uno) and give 20 pulses per wheel turn.
- An MPU6050 starts asleep and reads 0 until register 0x6B is cleared. Its gyro clips at the selected range (250 °/s by default).
- A TCS3200 with S0 and S1 both LOW is powered down, so `pulseIn` on OUT times out.

## Plan

1. Engine: parts catalog, arena geometry, transpiler, runtime, simulator. Covered by `npm test`.
2. Coach: static checks (missing semicolons, `if (x = 1)`, `if (...);`), runtime diagnosis (steering reversed, lost line, hit wall, spinning, never moved, slow loop, wrong pins) and generated working code shown as a diff.
3. Workbench: part picker with live top-down preview, pin wiring table, arena editor (draw tape lines, walls, start, finish, objects), preset arenas, code editor, run controls, trail and failure markers.
4. Landing page: robot mascot, how it works, parts bin, live demo, bot types.

## Roadmap

- Line follower, maze solver, grabber, obstacle avoider, sumo bot: available.
- Pixy2 camera: line-tracking mode (getMainFeatures, vectors, intersections) and colour signatures (`pixy.ccc.getBlocks()`, red/green/blue/yellow as signatures 1-4). Barcode mode is not simulated yet.
- Wheel encoders, MPU6050 (Wire, MPU6050 and Adafruit_MPU6050 styles) and TCS3200 colour sensor: available. `getMotion6()` is not, because it needs pointers.
- Humanoid and aerial bots: need a 3D view and a different physics model. Planned after the 2D bench is solid.
- Saving more than one project: available with an account. Sharing arenas on their own by link is not.
