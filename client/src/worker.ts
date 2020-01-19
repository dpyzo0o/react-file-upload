import SparkMD5 from 'spark-md5';

export interface IMessage {
  percentage: number;
  hash?: string;
}

export function generateFileHash(fileChunks: Blob[]) {
  const spark = new SparkMD5.ArrayBuffer();
  const fileReader = new FileReader();
  let chunkIndex = 0;
  let percentage = 0;
  let message: IMessage;

  fileReader.onload = e => {
    const result = e.target?.result as ArrayBuffer;
    spark.append(result);
    chunkIndex++;
    percentage += (1 / fileChunks.length) * 100;

    if (chunkIndex < fileChunks.length) {
      message = { percentage };
      self.postMessage(message);
      loadNext();
    } else {
      message = { percentage: 100, hash: spark.end() };
      self.postMessage(message);
    }
  };

  function loadNext() {
    fileReader.readAsArrayBuffer(fileChunks[chunkIndex]);
  }

  loadNext();
}
