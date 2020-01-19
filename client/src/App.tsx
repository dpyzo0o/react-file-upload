import React, { useState } from 'react';
// eslint-disable-next-line import/no-webpack-loader-syntax
import createWorker from 'workerize-loader!./worker';
import * as worker from './worker';

import './App.css';

interface FileChunk {
  chunk: Blob;
  chunkIndex: number;
  chunkSize: number;
  uploadPercentage: number;
}

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [hashPercentage, setHashPercentage] = useState(0);
  const [fileChunks, setFileChunks] = useState<FileChunk[]>([]);

  return (
    <div className="app">
      <h2>React File Upload</h2>
      <input type="file" onChange={handleFileChange} />
      <button onClick={handleUpload}>Upload</button>
      <div>hash progress: {hashPercentage}%</div>
      {fileChunks.map(fileChunk => (
        <div key={fileChunk.chunkIndex}>
          {fileChunk.chunkIndex} - {fileChunk.chunkSize} - {fileChunk.uploadPercentage}%
        </div>
      ))}
    </div>
  );

  function resetState() {
    setHashPercentage(0);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { files } = e.target;

    if (files) {
      setFile(files[0]);
    }

    resetState();
  }

  async function handleUpload() {
    if (!file) {
      alert('Please upload something!');
      return;
    }

    const chunks = createFileChunks(file, 10);
    const fileHash = await createFileHash(chunks);

    const fileChunks: FileChunk[] = chunks.map((chunk, index) => ({
      chunk,
      chunkIndex: index,
      chunkSize: chunk.size,
      uploadPercentage: 0,
    }));
    setFileChunks(fileChunks);

    const { shouldUpload } = await verifyUpload(file.name, fileHash);

    if (!shouldUpload) {
      alert('上传成功');
      return;
    }

    const requests = fileChunks.map(fileChunk => {
      const formData = new FormData();
      formData.append('fileName', file.name);
      formData.append('fileHash', fileHash);
      formData.append('chunkHash', `${fileHash}-${fileChunk.chunkIndex}`);
      formData.append('chunk', fileChunk.chunk);
      return futch({
        url: 'http://localhost:3001/api/upload',
        method: 'POST',
        data: formData,
      });
    });

    await Promise.all(requests);
    await futch({
      url: 'http://localhost:3001/api/merge',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ fileName: file.name, fileHash }),
    });
  }

  function createFileChunks(file: File, num: number): Blob[] {
    const fileChunks: Blob[] = [];
    const chunkSize = Math.ceil(file.size / num);

    let size = 0;
    while (size < file.size) {
      fileChunks.push(file.slice(size, size + chunkSize));
      size += chunkSize;
    }

    return fileChunks;
  }

  function createFileHash(fileChunks: Blob[]) {
    return new Promise<string>(resolve => {
      const workerInstance = createWorker<typeof worker>();
      workerInstance.generateFileHash(fileChunks);

      workerInstance.onmessage = function(e) {
        const { percentage, hash }: worker.IMessage = e.data;
        setHashPercentage(percentage);
        if (hash) {
          resolve(hash);
        }
      };
    });
  }

  async function verifyUpload(fileName: string, fileHash: string) {
    interface VerifyResponse {
      shouldUpload: boolean;
      uploadedChunks: string[];
    }

    return await futch<VerifyResponse>({
      url: 'http://localhost:3001/api/verify',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ fileName, fileHash }),
    });
  }
};

export default App;

interface FutchOption {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  data?: BodyInit;
  onUploadProgress?: (e: ProgressEvent<EventTarget>) => void;
}

function futch<T>(option: FutchOption) {
  const { url, method = 'GET', headers, data, onUploadProgress } = option;

  return new Promise<T>(resolve => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = e => onUploadProgress?.(e);

    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.response));
      } catch (error) {
        resolve(xhr.response);
      }
    };

    xhr.open(method, url);

    if (headers) {
      Object.keys(headers).forEach(key => xhr.setRequestHeader(key, headers[key]));
    }

    xhr.send(data);
  });
}
