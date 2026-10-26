#!/usr/bin/env node
/*
 * --- inspiration --- A stand-in for YouTube's image host (i.ytimg.com) in tests/inspirationCli.test.ts: inspire's stills
 * fallback reads it through JBL_STILLS_ORIGIN, so no test reaches the network. It serves the JPEG files of the folder given
 * as its first argument for /vi/<an 11-character id>/<name>.jpg (frame0, hq1, hq2, hq3, oardefault; a name without its file
 * is a 404, as YouTube answers for a still it lacks), on 127.0.0.1 at a free port it prints on stdout, and appends each
 * requested path to the file named by its second argument.
 */
import fs from "fs";
import http from "http";
import path from "path";

const [dir, log] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  if (log) fs.appendFileSync(log, `${req.url ?? ""}\n`);
  const m = /^\/vi\/[A-Za-z0-9_-]{11}\/(frame0|hq1|hq2|hq3|oardefault)\.jpg$/.exec(req.url ?? "");
  const file = m ? path.join(dir, `${m[1]}.jpg`) : null;
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "image/jpeg" });
  fs.createReadStream(file).pipe(res);
});
server.listen(0, "127.0.0.1", () => process.stdout.write(`${server.address().port}\n`));
