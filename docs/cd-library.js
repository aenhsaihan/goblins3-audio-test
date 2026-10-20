'use client';
import { UnzipInflate } from './vendor/fflate.js';
const DATABASE_NAME = 'goblins3-audio-test-cd-library';
const DATABASE_VERSION = 1;
const FILE_STORE = 'files';
const META_STORE = 'meta';
const ACTIVE_LIBRARY_KEY = 'active-library';
const MAX_ARCHIVE_FILES = 5000;
const MAX_EXTRACTED_BYTES = 900 * 1024 * 1024;
const ZIP_CHUNK_SIZE = 1024 * 1024;
const STORAGE_CHUNK_SIZE = 4 * 1024 * 1024;
const ZIP_END_RECORD_SIZE = 22;
const ZIP_MAX_COMMENT_SIZE = 0xffff;
const requestResult = (request) => new Promise((resolve, reject) => {
    const timer = request.transaction?.mode === 'readonly'
        ? window.setTimeout(() => {
            reject(new Error('Reading the local CD library timed out. Close the app and other game tabs, then retry. Your files have not been deleted.'));
            try {
                request.transaction?.abort();
            }
            catch (_) { }
        }, 20000)
        : undefined;
    request.onsuccess = () => {
        window.clearTimeout(timer);
        resolve(request.result);
    };
    request.onerror = () => {
        window.clearTimeout(timer);
        reject(request.error ?? new Error('Browser storage request failed.'));
    };
});
const transactionDone = (transaction) => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ??
        new Error('Browser storage transaction was cancelled.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
});
const openDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const fail = (error) => {
        if (settled)
            return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
    };
    const timer = window.setTimeout(() => fail(new Error('Opening local CD storage timed out. Close the home-screen app and other game tabs, then retry. Your files have not been deleted.')), 20000);
    request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(FILE_STORE)) {
            const files = database.createObjectStore(FILE_STORE, {
                keyPath: 'key',
            });
            files.createIndex('libraryId', 'libraryId', { unique: false });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
            database.createObjectStore(META_STORE, { keyPath: 'key' });
        }
    };
    request.onsuccess = () => {
        if (settled) {
            request.result.close();
            return;
        }
        settled = true;
        window.clearTimeout(timer);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
    };
    request.onerror = () => fail(request.error ?? new Error('Could not open browser storage.'));
    request.onblocked = () => fail(new Error('Another game window is holding the CD library open. Close it and retry.'));
});
const normalizePath = (input) => {
    const segments = input
        .replaceAll('\\', '/')
        .replace(/^[a-zA-Z]:\//, '')
        .split('/')
        .filter((segment) => segment && segment !== '.');
    if (segments.some((segment) => segment === '..'))
        return '';
    return segments.join('/');
};
const isJunkPath = (path) => {
    const lower = path.toLowerCase();
    return (!path ||
        lower.startsWith('__macosx/') ||
        lower.endsWith('/.ds_store') ||
        lower === '.ds_store' ||
        lower.endsWith('/thumbs.db') ||
        lower === 'thumbs.db');
};
const isDirectChildOfRoot = (path, root) => {
    const prefix = root ? `${root}/` : '';
    if (!path.toLowerCase().startsWith(prefix.toLowerCase()))
        return false;
    const relativePath = path.slice(prefix.length);
    return Boolean(relativePath) && !relativePath.includes('/');
};
const selectCdFiles = (records) => {
    const match = identifyCdRoot(records);
    const selected = records.filter((record) => isDirectChildOfRoot(record.path, match.root));
    const seen = new Set();
    for (const record of selected) {
        const lowerPath = record.path.toLowerCase();
        if (seen.has(lowerPath)) {
            throw new Error(`This archive contains a duplicate file: ${record.path}`);
        }
        seen.add(lowerPath);
    }
    const selectedBytes = selected.reduce((sum, record) => sum + record.size, 0);
    if (selectedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error('The playable CD files expand beyond the safe 900 MB import limit.');
    }
    return { match, selected, selectedBytes };
};
const readZipDirectory = async (file) => {
    const tailStart = Math.max(0, file.size - ZIP_END_RECORD_SIZE - ZIP_MAX_COMMENT_SIZE);
    const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let endOffset = -1;
    for (let offset = tail.length - ZIP_END_RECORD_SIZE; offset >= 0; offset -= 1) {
        if (tailView.getUint32(offset, true) !== 0x06054b50)
            continue;
        const commentLength = tailView.getUint16(offset + 20, true);
        if (offset + ZIP_END_RECORD_SIZE + commentLength === tail.length) {
            endOffset = offset;
            break;
        }
    }
    if (endOffset < 0) {
        throw new Error('This file does not contain a readable ZIP directory.');
    }
    const diskNumber = tailView.getUint16(endOffset + 4, true);
    const directoryDisk = tailView.getUint16(endOffset + 6, true);
    const entriesOnDisk = tailView.getUint16(endOffset + 8, true);
    const entryCount = tailView.getUint16(endOffset + 10, true);
    const directorySize = tailView.getUint32(endOffset + 12, true);
    const directoryOffset = tailView.getUint32(endOffset + 16, true);
    if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
        throw new Error('Multi-part ZIP archives are not supported.');
    }
    if (entryCount === 0xffff ||
        directorySize === 0xffffffff ||
        directoryOffset === 0xffffffff) {
        throw new Error('ZIP64 archives are not supported on mobile yet.');
    }
    if (entryCount > MAX_ARCHIVE_FILES) {
        throw new Error('This ZIP contains too many files to be a Goblins 3 CD folder.');
    }
    if (directoryOffset + directorySize > file.size) {
        throw new Error('The ZIP directory points outside the selected file.');
    }
    const directory = new Uint8Array(await file
        .slice(directoryOffset, directoryOffset + directorySize)
        .arrayBuffer());
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    const utf8 = new TextDecoder('utf-8');
    const entries = [];
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > directory.length ||
            view.getUint32(offset, true) !== 0x02014b50) {
            throw new Error('The ZIP directory is incomplete or damaged.');
        }
        const flags = view.getUint16(offset + 8, true);
        const compression = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
        if (nextOffset > directory.length) {
            throw new Error('The ZIP directory contains a truncated file entry.');
        }
        if (compressedSize === 0xffffffff ||
            size === 0xffffffff ||
            localHeaderOffset === 0xffffffff) {
            throw new Error('ZIP64 file entries are not supported on mobile yet.');
        }
        const rawName = utf8.decode(directory.subarray(offset + 46, offset + 46 + nameLength));
        const path = normalizePath(rawName);
        if (path && !rawName.endsWith('/') && !isJunkPath(path)) {
            entries.push({
                path,
                size,
                compressedSize,
                compression,
                encrypted: Boolean(flags & 1),
                localHeaderOffset,
            });
        }
        offset = nextOffset;
    }
    return entries;
};
const extractZipEntry = async (file, entry, onCompressedBytes) => {
    const localHeader = new Uint8Array(await file
        .slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
        .arrayBuffer());
    if (localHeader.length !== 30 ||
        new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength).getUint32(0, true) !== 0x04034b50) {
        throw new Error(`Could not locate ${entry.path} inside the ZIP.`);
    }
    const localView = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
    const localCompression = localView.getUint16(8, true);
    const nameLength = localView.getUint16(26, true);
    const extraLength = localView.getUint16(28, true);
    if (localCompression !== entry.compression) {
        throw new Error(`The ZIP metadata for ${entry.path} is inconsistent.`);
    }
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataEnd > file.size) {
        throw new Error(`${entry.path} is truncated inside the ZIP.`);
    }
    const chunks = [];
    let extractedSize = 0;
    let extractionError = null;
    let finished = entry.compression === 0 && entry.compressedSize === 0;
    const receive = (error, data, final) => {
        if (error) {
            extractionError = error;
            return;
        }
        if (data?.length) {
            extractedSize += data.length;
            if (extractedSize > entry.size || extractedSize > MAX_EXTRACTED_BYTES) {
                extractionError = new Error(`${entry.path} expands beyond its ZIP size.`);
                return;
            }
            const copy = new Uint8Array(data.length);
            copy.set(data);
            chunks.push(copy.buffer);
        }
        if (final)
            finished = true;
    };
    const inflater = entry.compression === 8 ? new UnzipInflate() : null;
    if (inflater)
        inflater.ondata = receive;
    for (let offset = dataOffset; offset < dataEnd; offset += ZIP_CHUNK_SIZE) {
        const end = Math.min(dataEnd, offset + ZIP_CHUNK_SIZE);
        const data = new Uint8Array(await file.slice(offset, end).arrayBuffer());
        const final = end === dataEnd;
        if (inflater) {
            inflater.push(data, final);
        }
        else {
            receive(null, data, final);
        }
        if (extractionError)
            throw extractionError;
        onCompressedBytes(data.length);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (extractionError)
        throw extractionError;
    if (!finished || extractedSize !== entry.size) {
        throw new Error(`${entry.path} did not extract to its expected size.`);
    }
    return new Blob(chunks, { type: 'application/octet-stream' });
};
const putFileChunk = async (record) => {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(FILE_STORE, 'readwrite');
        const request = transaction.objectStore(FILE_STORE).put(record);
        await Promise.all([requestResult(request), transactionDone(transaction)]);
    }
    finally {
        database.close();
    }
};
const putFile = async (libraryId, path, size, blob, onChunk) => {
    const chunkCount = Math.max(1, Math.ceil(size / STORAGE_CHUNK_SIZE));
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const start = chunkIndex * STORAGE_CHUNK_SIZE;
        const chunk = blob.slice(start, Math.min(size, start + STORAGE_CHUNK_SIZE));
        try {
            const data = await chunk.arrayBuffer();
            await putFileChunk({
                key: `${libraryId}:${path}:${String(chunkIndex).padStart(5, '0')}`,
                libraryId,
                path,
                size: chunk.size,
                fileSize: size,
                chunkIndex,
                chunkCount,
                data,
            });
        }
        catch (error) {
            const detail = error instanceof DOMException
                ? `${error.name}: ${error.message}`
                : error instanceof Error
                    ? error.message
                    : String(error);
            throw new Error(`Could not save ${path} (part ${chunkIndex + 1} of ${chunkCount}). ${detail}`, { cause: error });
        }
        onChunk?.(chunkIndex, chunkCount);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
};
const deleteLibraryFiles = async (libraryId, keepRoot) => {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(FILE_STORE, 'readwrite');
        const store = transaction.objectStore(FILE_STORE);
        const index = store.index('libraryId');
        const request = index.openCursor(IDBKeyRange.only(libraryId));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor)
                return;
            const record = cursor.value;
            const inRoot = keepRoot !== undefined &&
                (keepRoot === '' ||
                    record.path === keepRoot ||
                    record.path.startsWith(`${keepRoot}/`));
            if (!inRoot)
                cursor.delete();
            cursor.continue();
        };
        await transactionDone(transaction);
    }
    finally {
        database.close();
    }
};
const saveMetadata = async (metadata) => {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(META_STORE, 'readwrite');
        transaction.objectStore(META_STORE).put(metadata);
        await transactionDone(transaction);
    }
    finally {
        database.close();
    }
};
const identifyCdRoot = (records) => {
    const byLowerPath = new Map(records.map((record) => [record.path.toLowerCase(), record]));
    const candidates = records
        .filter((record) => record.path.split('/').at(-1)?.toLowerCase() === 'intro.stk')
        .map((record) => {
        const slash = record.path.lastIndexOf('/');
        const root = slash < 0 ? '' : record.path.slice(0, slash);
        const markerPath = `${root ? `${root}/` : ''}mus_gob3.lic`.toLowerCase();
        return { intro: record, root, hasCdMarker: byLowerPath.has(markerPath) };
    })
        .filter((candidate) => candidate.hasCdMarker)
        .sort((a, b) => a.root.split('/').length - b.root.split('/').length);
    if (!candidates.length) {
        throw new Error('This does not look like the Goblins 3 DOS CD edition. The folder must contain both intro.stk and mus_gob3.lic.');
    }
    const selected = candidates[0];
    const releaseBySize = {
        612482: 'DOS CD v1.02',
        616220: 'DOS CD v1.02',
        619825: 'DOS CD v1.02',
    };
    return {
        root: selected.root,
        introSize: selected.intro.size,
        release: releaseBySize[selected.intro.size] ?? 'DOS CD edition',
    };
};
const finalizeImport = async (libraryId, records, sourceName) => {
    const previousLibrary = await getCdLibraryMetadata();
    const match = identifyCdRoot(records);
    const prefix = match.root ? `${match.root}/` : '';
    const keptRecords = records.filter((record) => !prefix || record.path === match.root || record.path.startsWith(prefix));
    await deleteLibraryFiles(libraryId, match.root);
    const metadata = {
        key: ACTIVE_LIBRARY_KEY,
        libraryId,
        root: match.root,
        fileCount: keptRecords.length,
        totalBytes: keptRecords.reduce((sum, record) => sum + record.size, 0),
        introSize: match.introSize,
        release: match.release,
        sourceName,
        importedAt: new Date().toISOString(),
    };
    await saveMetadata(metadata);
    if (previousLibrary && previousLibrary.libraryId !== libraryId) {
        await deleteLibraryFiles(previousLibrary.libraryId).catch(() => { });
    }
    return metadata;
};
const explainStorageError = (error) => {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        return new Error('This browser ran out of local storage while copying the CD. Free some device space, then try again.');
    }
    return error instanceof Error ? error : new Error(String(error));
};
export async function getCdLibraryMetadata() {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(META_STORE, 'readonly');
        const result = await requestResult(transaction.objectStore(META_STORE).get(ACTIVE_LIBRARY_KEY));
        return result ?? null;
    }
    finally {
        database.close();
    }
}
export async function clearCdLibrary() {
    const metadata = await getCdLibraryMetadata();
    const database = await openDatabase();
    try {
        const transaction = database.transaction(META_STORE, 'readwrite');
        transaction.objectStore(META_STORE).delete(ACTIVE_LIBRARY_KEY);
        await transactionDone(transaction);
    }
    finally {
        database.close();
    }
    if (metadata)
        await deleteLibraryFiles(metadata.libraryId);
}
export async function importCdFolder(files, options) {
    const libraryId = crypto.randomUUID();
    const records = [];
    try {
        await navigator.storage?.persist?.().catch(() => false);
        const usableFiles = Array.from(files)
            .map((file) => {
            const directoryFile = file;
            return {
                file,
                path: normalizePath(directoryFile.webkitRelativePath || directoryFile.name),
                size: file.size,
            };
        })
            .filter((record) => record.size > 0 && !isJunkPath(record.path));
        const { selected } = selectCdFiles(usableFiles);
        for (let index = 0; index < selected.length; index += 1) {
            const { file, path, size } = selected[index];
            options.onProgress?.({
                phase: 'saving',
                percent: Math.round(((index + 1) / selected.length) * 92),
                detail: `Copying CD file ${index + 1} of ${selected.length}…`,
            });
            await putFile(libraryId, path, size, file);
            records.push({ path, size });
        }
        options.onProgress?.({
            phase: 'validating',
            percent: 96,
            detail: 'Checking the CD edition…',
        });
        return await finalizeImport(libraryId, records, options.sourceName);
    }
    catch (error) {
        await deleteLibraryFiles(libraryId).catch(() => { });
        throw explainStorageError(error);
    }
}
export async function importCdZip(file, options) {
    const libraryId = crypto.randomUUID();
    const records = [];
    try {
        await navigator.storage?.persist?.().catch(() => false);
        options.onProgress?.({
            phase: 'reading',
            percent: 2,
            detail: 'Inspecting the ZIP directory…',
        });
        const entries = await readZipDirectory(file);
        const { selected } = selectCdFiles(entries);
        for (const entry of selected) {
            if (entry.encrypted) {
                throw new Error(`${entry.path} is encrypted and cannot be imported.`);
            }
            if (entry.compression !== 0 && entry.compression !== 8) {
                throw new Error(`${entry.path} uses an unsupported ZIP compression method.`);
            }
        }
        const totalCompressedBytes = selected.reduce((sum, entry) => sum + entry.compressedSize, 0);
        let processedCompressedBytes = 0;
        for (let index = 0; index < selected.length; index += 1) {
            const entry = selected[index];
            const blob = await extractZipEntry(file, entry, (bytes) => {
                processedCompressedBytes += bytes;
                const extractionProgress = totalCompressedBytes
                    ? processedCompressedBytes / totalCompressedBytes
                    : 1;
                options.onProgress?.({
                    phase: 'reading',
                    percent: 5 + Math.round(extractionProgress * 80),
                    detail: `Extracting CD file ${index + 1} of ${selected.length}…`,
                });
            });
            options.onProgress?.({
                phase: 'saving',
                percent: 86 + Math.round(((index + 1) / selected.length) * 7),
                detail: `Saving CD file ${index + 1} of ${selected.length}…`,
            });
            await putFile(libraryId, entry.path, entry.size, blob, (chunkIndex, chunkCount) => {
                options.onProgress?.({
                    phase: 'saving',
                    percent: 86 + Math.round(((index + 1) / selected.length) * 7),
                    detail: `Saving CD file ${index + 1} of ${selected.length} · part ${chunkIndex + 1}/${chunkCount}…`,
                });
            });
            records.push({ path: entry.path, size: entry.size });
        }
        options.onProgress?.({
            phase: 'validating',
            percent: 96,
            detail: 'Checking the CD edition…',
        });
        return await finalizeImport(libraryId, records, options.sourceName);
    }
    catch (error) {
        await deleteLibraryFiles(libraryId).catch(() => { });
        throw explainStorageError(error);
    }
}
export function formatBytes(bytes) {
    if (bytes < 1024 * 1024)
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}
