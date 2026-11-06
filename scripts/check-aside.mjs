import http from 'http';

http.get('http://localhost:3000', (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const navIdx = d.indexOf('<nav');
    const navEnd = d.indexOf('</nav>');
    console.log('NAV HTML:\n', d.slice(navIdx, navEnd + 6));
  });
});
