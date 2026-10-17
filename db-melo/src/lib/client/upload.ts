// Envoi de fichier avec progression (XMLHttpRequest : fetch ne donne pas la progression d'envoi).
export interface UploadedFile {
  id: string;
  kind: "reference" | "photo";
  fileName: string;
  size: number;
  mime: string;
}

export function uploadFile(file: File, kind: "reference" | "photo", onProgress?: (ratio: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: { upload?: UploadedFile; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* réponse non JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.upload) resolve(data.upload);
      else reject(new Error(data.error ?? `Envoi impossible (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Connexion interrompue pendant l'envoi."));
    xhr.send(form);
  });
}
