import http, { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Busboy from 'busboy';

const port = 3001;
const uploadDir = path.resolve(__dirname, '..', 'upload');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.statusCode = 200;
    res.end();
    return;
  }

  // real requests
  if (req.url === '/api/verify') {
    verifyHandler(req, res);
  } else if (req.url === '/api/upload') {
    uploadHandler(req, res);
  } else if (req.url === '/api/merge') {
    mergeHandler(req, res);
  } else {
    defaultHandler(req, res);
  }
});

server.listen(port, () => console.log(`Server is running at http://localhost:${port}`));

async function verifyHandler(req: IncomingMessage, res: ServerResponse) {
  interface VerifyResponse {
    shouldUpload: boolean;
    uploadedChunks: string[];
  }

  const { fileName, fileHash } = await parseBody(req);
  const filePath = path.join(uploadDir, fileName);
  let data: VerifyResponse = { shouldUpload: false, uploadedChunks: [] };

  if (!fs.existsSync(filePath)) {
    const chunkDir = path.join(uploadDir, fileHash);
    const uploadedChunks = fs.existsSync(chunkDir) ? fs.readdirSync(chunkDir) : [];
    data.shouldUpload = true;
    data.uploadedChunks = uploadedChunks;
  }

  res.statusCode = 200;
  res.end(JSON.stringify(data));
}

async function uploadHandler(req: IncomingMessage, res: ServerResponse) {
  const busboy = new Busboy({ headers: req.headers });
  let fileName: string;
  let fileHash: string;
  let chunkHash: string;

  /**
   * 'filed' event is fired before 'file' event provided that
   * non-file filed is placed before file filed in FormData
   */
  busboy.on('field', (fieldname, val) => {
    if (fieldname === 'fileName') {
      fileName = val;
    } else if (fieldname === 'fileHash') {
      fileHash = val;
    } else if (fieldname === 'chunkHash') {
      chunkHash = val;
    }
  });

  busboy.on('file', (_, file) => {
    const chunkDir = path.join(uploadDir, fileHash);
    const filePath = path.join(uploadDir, `${fileHash}${path.extname(fileName)}`);

    if (fs.existsSync(filePath)) {
      res.statusCode = 200;
      res.end('file already exists');
      return;
    }

    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    // save to system temp dir first, then move to upload dir
    const saveTo = path.join(chunkDir, chunkHash);
    const tmpSaveTo = path.join(os.tmpdir(), chunkHash);
    const stream = fs.createWriteStream(tmpSaveTo);
    stream.on('finish', () => fs.renameSync(tmpSaveTo, saveTo));

    file.pipe(stream);
  });

  busboy.on('finish', () => {
    res.statusCode = 200;
    res.end('file chunk uploaded');
  });

  req.pipe(busboy);
}

async function mergeHandler(req: IncomingMessage, res: ServerResponse) {
  const { fileName, fileHash } = await parseBody(req);
  const filePath = path.join(uploadDir, fileName);
  const chunkDir = path.join(uploadDir, fileHash);

  fs.readdirSync(chunkDir).forEach(chunk => {
    const chunkPath = path.join(chunkDir, chunk);
    fs.appendFileSync(filePath, fs.readFileSync(chunkPath));
    fs.unlinkSync(chunkPath);
  });

  fs.rmdirSync(chunkDir);

  res.statusCode = 200;
  res.end('file chunks merged');
}

async function defaultHandler(req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.end('hello world');
}

function parseBody(req: IncomingMessage) {
  return new Promise<any>(resolve => {
    let body = '';
    req.on('data', data => {
      body += data;
    });
    req.on('end', () => {
      resolve(JSON.parse(body));
    });
  });
}
