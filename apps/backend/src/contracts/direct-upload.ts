export interface UploadObject {
  key: string;
  version: string;
}

export interface UploadMetadata extends UploadObject {
  sizeBytes: number;
  contentType: string;
}

export interface UploadExpectation {
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface UploadGrant {
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  fields?: Record<string, string>;
  expiresAt: Date;
}

/** Optional capability; callers authorize and persist intent before issuing a grant. */
export interface DirectUploadStorage {
  /** The grant must enforce the expected size and type at the storage boundary. */
  prepareUpload(expected: UploadExpectation, expiresAt: Date): Promise<UploadGrant>;
  inspectUpload(key: string): Promise<UploadMetadata | null>;
  /** Copy only this version, without replacing an existing destination object. */
  promoteUpload(source: UploadObject, destinationKey: string): Promise<UploadMetadata>;
  readObject(object: UploadObject): Promise<Buffer>;
  /** Missing objects are a success; a different version must never be deleted. */
  deleteObject(object: UploadObject): Promise<void>;
}
