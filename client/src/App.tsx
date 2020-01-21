import React, { useState, useEffect, useMemo } from 'react';
import {
  Button,
  LinearProgress,
  Snackbar,
  Paper,
  AppBar,
  Toolbar,
  Typography,
  Container,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { CloudUpload } from '@material-ui/icons';
// eslint-disable-next-line import/no-webpack-loader-syntax
import createWorker from 'workerize-loader!./worker';
import * as worker from './worker';

interface FileChunk {
  chunk: Blob;
  chunkIndex: number;
  chunkSize: number;
  uploadPercentage: number;
}

enum UploadStatus {
  INITIAL,
  HASHING,
  PENDING,
  PAUSED,
  SUCCESS,
}

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [hashPercentage, setHashPercentage] = useState(0);
  const [fileChunks, setFileChunks] = useState<FileChunk[]>([]);
  const [status, setStatus] = useState<UploadStatus>(UploadStatus.INITIAL);
  const [ongoingRequests, setOngoingRequests] = useState<XMLHttpRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [fakeTotalPercentage, setFakeTotalPercentage] = useState(0);

  const totalPercentage = useMemo(() => {
    if (status === UploadStatus.SUCCESS) {
      return 100;
    }

    if (!fileChunks.length || status === UploadStatus.INITIAL) {
      return 0;
    }

    const chunkUploadPercentage =
      fileChunks.reduce((total, chunk) => total + chunk.uploadPercentage, 0) / fileChunks.length;
    // fake merging time
    return chunkUploadPercentage - 5;
  }, [fileChunks, status]);

  const uploadDisabled = useMemo(
    () =>
      !file ||
      status === UploadStatus.PENDING ||
      status === UploadStatus.PAUSED ||
      status === UploadStatus.HASHING,
    [file, status]
  );

  useEffect(() => {
    if (status === UploadStatus.SUCCESS) {
      setOpen(true);
    }
  }, [status]);

  useEffect(() => {
    if (totalPercentage > fakeTotalPercentage || totalPercentage === 0) {
      setFakeTotalPercentage(totalPercentage);
    }
  }, [totalPercentage, fakeTotalPercentage]);

  return (
    <Paper elevation={0} style={{ padding: 0, margin: 0 }}>
      <AppBar color="primary" position="static">
        <Toolbar>
          <Typography color="inherit" variant="h6">
            React File Upload
          </Typography>
        </Toolbar>
      </AppBar>
      <Container style={{ padding: 16 }}>
        <input
          id="contained-button-file"
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <label htmlFor="contained-button-file">
          <Button variant="contained" component="span" color="primary" startIcon={<CloudUpload />}>
            choose file
          </Button>
        </label>
        <span>{file?.name}</span>
        <Container style={{ padding: 0, margin: '16px 0' }}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleUpload}
            disabled={uploadDisabled}
            style={{ marginRight: 16 }}
          >
            Upload
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handlePause}
            disabled={status !== UploadStatus.PAUSED && status !== UploadStatus.PENDING}
          >
            {status === UploadStatus.PAUSED ? 'resume' : 'pause'}
          </Button>
        </Container>
        <Container style={{ padding: 0 }}>
          <div>hash progress: {Math.floor(hashPercentage)}%</div>
          <LinearProgress variant="determinate" value={hashPercentage} />
          <div>total progress: {Math.floor(fakeTotalPercentage)}%</div>
          <LinearProgress variant="determinate" value={fakeTotalPercentage} />
        </Container>
        {fileChunks.map(fileChunk => (
          <Container key={fileChunk.chunkIndex} style={{ padding: 0 }}>
            <div>
              chunk - {fileChunk.chunkIndex}: {Math.floor(fileChunk.uploadPercentage)}%
            </div>
            <LinearProgress variant="determinate" value={fileChunk.uploadPercentage} />
          </Container>
        ))}
        <Snackbar
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          open={open}
          onClose={() => setOpen(false)}
          autoHideDuration={3000}
        >
          <Alert severity="success">上传成功</Alert>
        </Snackbar>
      </Container>
    </Paper>
  );

  function resetState() {
    setHashPercentage(0);
    setStatus(UploadStatus.INITIAL);
    setFileChunks([]);
  }

  async function handlePause() {
    if (status === UploadStatus.PAUSED) {
      const { uploadedChunks } = await verifyUpload(file!.name, fileHash!);
      await uploadChunks(file!, fileHash!, fileChunks, uploadedChunks);
    } else {
      setStatus(UploadStatus.PAUSED);
      ongoingRequests.forEach(xhr => xhr?.abort());
    }
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

    setStatus(UploadStatus.HASHING);
    const chunks = createFileChunks(file, 10);
    const fileHash = await createFileHash(chunks);
    setFileHash(fileHash);

    const { shouldUpload, uploadedChunks } = await verifyUpload(file.name, fileHash);

    if (!shouldUpload) {
      setStatus(UploadStatus.SUCCESS);
      return;
    }

    const fileChunks: FileChunk[] = chunks.map((chunk, index) => ({
      chunk,
      chunkIndex: index,
      chunkSize: chunk.size,
      uploadPercentage: uploadedChunks.includes(`${fileHash}-${index}`) ? 100 : 0,
    }));
    setFileChunks(fileChunks);

    await uploadChunks(file, fileHash, fileChunks, uploadedChunks);
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
        if (percentage) {
          setHashPercentage(percentage);
          if (hash) {
            resolve(hash);
          }
        }
      };
    });
  }

  async function uploadChunks(
    file: File,
    fileHash: string,
    chunksToUpload: FileChunk[],
    uploadedChunks: string[]
  ) {
    const requests = chunksToUpload
      .filter(chunk => !uploadedChunks.includes(`${fileHash}-${chunk.chunkIndex}`))
      .map(chunk => {
        const formData = new FormData();
        formData.append('fileName', file.name);
        formData.append('fileHash', fileHash);
        formData.append('chunkHash', `${fileHash}-${chunk.chunkIndex}`);
        formData.append('chunk', chunk.chunk);
        return futch({
          url: 'http://localhost:3001/api/upload',
          data: formData,
          setOngoingRequests,
          onUploadProgress: e => handleUploadProgress(e, chunk.chunkIndex),
        });
      });

    setStatus(UploadStatus.PENDING);
    await Promise.all(requests);

    // merge
    await futch({
      url: 'http://localhost:3001/api/merge',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ fileName: file.name, fileHash }),
    });
    setStatus(UploadStatus.SUCCESS);
  }

  function handleUploadProgress(e: ProgressEvent<EventTarget>, chunkIndex: number) {
    const percentage = (e.loaded / e.total) * 100;

    setFileChunks(fileChunks =>
      fileChunks.map(chunk => {
        if (chunk.chunkIndex === chunkIndex) {
          return { ...chunk, uploadPercentage: percentage };
        } else {
          return chunk;
        }
      })
    );
  }

  async function verifyUpload(fileName: string, fileHash: string) {
    interface VerifyResponse {
      shouldUpload: boolean;
      uploadedChunks: string[];
    }

    return await futch<VerifyResponse>({
      url: 'http://localhost:3001/api/verify',
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
  ongoingRequests?: XMLHttpRequest[];
  setOngoingRequests?: React.Dispatch<React.SetStateAction<XMLHttpRequest[]>>;
}

function futch<T>(option: FutchOption) {
  const { url, method = 'POST', headers, data, onUploadProgress, setOngoingRequests } = option;

  return new Promise<T>(resolve => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = e => onUploadProgress?.(e);

    xhr.onload = () => {
      // remove finished xhr
      setOngoingRequests?.(ongoingRequests => ongoingRequests.filter(r => r !== xhr));

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

    // add xhr to ongoing request list
    setOngoingRequests?.(ongoingRequests => [...ongoingRequests, xhr]);
  });
}
