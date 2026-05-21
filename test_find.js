import fs from 'fs';
const js = fs.readFileSync('chunk_9973.js', 'utf8');

const listStart = js.indexOf('A=[{name:"Neon"');

// Let's print more of the functions that define these letters.
// Let's extract and print the definitions of v, _, V, T, D, O, E, S, x, M
console.log("Functions definitions:\n", js.substring(listStart - 6000, listStart));
