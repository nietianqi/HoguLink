import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const target = fileURLToPath(new URL('../hogulink-web/public/portraits/', import.meta.url));
mkdirSync(target, { recursive: true });
const people = [
  {
    id: 'aoi',
    bg: '#efe9df',
    wall: '#e1d7c7',
    uniform: '#24463c',
    skin: '#dec2a5',
    hair: '#3e4640',
    long: true,
    glasses: false,
  },
  {
    id: 'ren',
    bg: '#ece6dc',
    wall: '#ddd2c0',
    uniform: '#2e4a41',
    skin: '#c6a486',
    hair: '#41433c',
    long: false,
    glasses: true,
  },
  {
    id: 'mio',
    bg: '#eeeae3',
    wall: '#dfd8cb',
    uniform: '#2a4339',
    skin: '#e1c4ad',
    hair: '#404a4d',
    long: true,
    glasses: false,
  },
  {
    id: 'haru',
    bg: '#f0e9df',
    wall: '#e3d5c3',
    uniform: '#34493f',
    skin: '#d9b89c',
    hair: '#514b43',
    long: false,
    glasses: false,
  },
  {
    id: 'yuki',
    bg: '#ebe7dd',
    wall: '#dcd4c4',
    uniform: '#28453b',
    skin: '#d6bda7',
    hair: '#494c42',
    long: true,
    glasses: true,
  },
  {
    id: 'saki',
    bg: '#efe7da',
    wall: '#e0d2bd',
    uniform: '#31483f',
    skin: '#e3c6ac',
    hair: '#514d44',
    long: false,
    glasses: false,
  },
];
for (const [i, p] of people.entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440" role="img" aria-label="Fictional demo staff illustration"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${p.bg}"/><stop offset="1" stop-color="${p.wall}"/></linearGradient><linearGradient id="shirt" x2="1" y2="1"><stop stop-color="${p.uniform}"/><stop offset="1" stop-color="${p.uniform}" stop-opacity=".82"/></linearGradient></defs><path fill="url(#bg)" d="M0 0h600v440H0z"/><path d="M25 440V178a132 132 0 0 1 264 0v262" fill="${p.bg}" opacity=".7"/><path d="M470 0v440m12-440v440" stroke="#fff" stroke-opacity=".22" stroke-width="2"/><ellipse cx="320" cy="443" rx="152" ry="14" fill="${p.hair}" opacity=".1"/>
 ${p.long ? `<path d="M238 135q0-78 82-80 89 2 88 89l12 169-193 3z" fill="${p.hair}"/>` : `<path d="M244 144q-12-79 78-83 96-3 82 91l-15 43-130-4z" fill="${p.hair}"/>`}
 <path d="M191 440q0-103 48-133l50-17h61l51 16q54 24 55 134z" fill="url(#shirt)"/><path d="M289 252v52q29 36 61 0v-52" fill="${p.skin}"/><path d="M289 274q32 19 61-2v14q-31 18-61-1" fill="${p.hair}" opacity=".09"/><ellipse cx="252" cy="188" rx="12" ry="21" fill="${p.skin}"/><ellipse cx="390" cy="188" rx="12" ry="21" fill="${p.skin}"/><path d="M254 146q-3-59 66-60 72-1 70 61l-4 65q-3 61-65 69-63-9-67-69z" fill="${p.skin}"/>
 <path d="M246 149q-16-83 75-85 90-4 77 83-53-4-79-49-18 42-73 51" fill="${p.hair}"/><path d="M273 177q12-5 22-1m50 0q11-4 22 2" fill="none" stroke="${p.hair}" stroke-width="3" stroke-linecap="round"/><path d="M276 191q7 4 13 0m60 0q7 4 13 0" fill="none" stroke="${p.hair}" stroke-width="3" stroke-linecap="round"/><path d="m319 192-5 25 10 1" fill="none" stroke="${p.hair}" stroke-width="2" opacity=".2"/><path d="M305 239q16 9 31-1" fill="none" stroke="#a77f69" stroke-width="2.5" stroke-linecap="round"/>
 ${p.glasses ? `<g fill="none" stroke="${p.hair}" stroke-width="2.3" opacity=".7"><rect x="266" y="179" width="39" height="26" rx="8"/><rect x="338" y="179" width="39" height="26" rx="8"/><path d="M305 188q17-9 33 0m-72-1-12-4m123 4 13-4"/></g>` : ''}
 <path d="m280 292 39 33-25 25-28-51m94-7-41 33 25 25 29-51" fill="${p.bg}" opacity=".9"/><path d="M319 325v115" stroke="${p.bg}" stroke-opacity=".3" stroke-width="2"/><circle cx="328" cy="370" r="2" fill="${p.bg}"/><circle cx="328" cy="397" r="2" fill="${p.bg}"/><path d="M368 349h31v25h-31z" fill="${p.bg}" opacity=".65"/><path d="M373 356h20m-20 6h14" stroke="${p.uniform}" stroke-width="2"/><path d="m230 351-8 89m190-89 9 89" stroke="${p.hair}" opacity=".1" stroke-width="3"/><path d="M515 376h45v64h-45" fill="${p.bg}" opacity=".5"/><text x="570" y="419" font-family="Arial,sans-serif" font-size="9" text-anchor="end" letter-spacing="2" fill="${p.hair}" opacity=".32">HL / 0${i + 1}</text></svg>`;
  writeFileSync(`${target}/${p.id}.svg`, svg);
}
console.log('Six fictional staff illustrations generated.');
