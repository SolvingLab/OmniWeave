import * as fs from 'fs';

export const SCIP_SYMBOL_ROLE_DEFINITION = 0x1;
export const SCIP_SYMBOL_ROLE_READ_ACCESS = 0x8;
export const SCIP_SYMBOL_ROLE_FORWARD_DEFINITION = 0x40;

export interface ScipIndex {
  metadata?: ScipMetadata;
  documents: ScipDocument[];
  externalSymbols: ScipSymbolInformation[];
}

export interface ScipMetadata {
  toolInfo?: ScipToolInfo;
  projectRoot: string;
  textDocumentEncoding: number;
}

export interface ScipToolInfo {
  name: string;
  version: string;
  arguments: string[];
}

export interface ScipDocument {
  relativePath: string;
  language: string;
  occurrences: ScipOccurrence[];
  symbols: ScipSymbolInformation[];
  text: string;
  positionEncoding: number;
}

export interface ScipSymbolInformation {
  symbol: string;
  documentation: string[];
  relationships: ScipRelationship[];
  kind: number;
  displayName: string;
  signature?: ScipSignature;
  enclosingSymbol: string;
}

export interface ScipSignature {
  language: string;
  text: string;
}

export interface ScipRelationship {
  symbol: string;
  isReference: boolean;
  isImplementation: boolean;
  isTypeDefinition: boolean;
  isDefinition: boolean;
}

export interface ScipOccurrence {
  range: number[];
  symbol: string;
  symbolRoles: number;
  syntaxKind: number;
}

export function decodeScipIndexFile(filePath: string): ScipIndex {
  return decodeScipIndex(fs.readFileSync(filePath));
}

export function decodeScipIndex(bytes: Uint8Array): ScipIndex {
  const reader = new ProtoReader(bytes);
  const index: ScipIndex = { documents: [], externalSymbols: [] };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        index.metadata = decodeMessage(reader.readBytes(field.wireType), decodeMetadata);
        break;
      case 2:
        index.documents.push(decodeMessage(reader.readBytes(field.wireType), decodeDocument));
        break;
      case 3:
        index.externalSymbols.push(decodeMessage(reader.readBytes(field.wireType), decodeSymbolInformation));
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return index;
}

function decodeMetadata(bytes: Uint8Array): ScipMetadata {
  const reader = new ProtoReader(bytes);
  const metadata: ScipMetadata = { projectRoot: '', textDocumentEncoding: 0 };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 2:
        metadata.toolInfo = decodeMessage(reader.readBytes(field.wireType), decodeToolInfo);
        break;
      case 3:
        metadata.projectRoot = reader.readString(field.wireType);
        break;
      case 4:
        metadata.textDocumentEncoding = reader.readVarintForField(field.wireType);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return metadata;
}

function decodeToolInfo(bytes: Uint8Array): ScipToolInfo {
  const reader = new ProtoReader(bytes);
  const toolInfo: ScipToolInfo = { name: '', version: '', arguments: [] };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        toolInfo.name = reader.readString(field.wireType);
        break;
      case 2:
        toolInfo.version = reader.readString(field.wireType);
        break;
      case 3:
        toolInfo.arguments.push(reader.readString(field.wireType));
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return toolInfo;
}

function decodeDocument(bytes: Uint8Array): ScipDocument {
  const reader = new ProtoReader(bytes);
  const document: ScipDocument = {
    relativePath: '',
    language: '',
    occurrences: [],
    symbols: [],
    text: '',
    positionEncoding: 0,
  };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        document.relativePath = reader.readString(field.wireType);
        break;
      case 2:
        document.occurrences.push(decodeMessage(reader.readBytes(field.wireType), decodeOccurrence));
        break;
      case 3:
        document.symbols.push(decodeMessage(reader.readBytes(field.wireType), decodeSymbolInformation));
        break;
      case 4:
        document.language = reader.readString(field.wireType);
        break;
      case 5:
        document.text = reader.readString(field.wireType);
        break;
      case 6:
        document.positionEncoding = reader.readVarintForField(field.wireType);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return document;
}

function decodeSymbolInformation(bytes: Uint8Array): ScipSymbolInformation {
  const reader = new ProtoReader(bytes);
  const info: ScipSymbolInformation = {
    symbol: '',
    documentation: [],
    relationships: [],
    kind: 0,
    displayName: '',
    enclosingSymbol: '',
  };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        info.symbol = reader.readString(field.wireType);
        break;
      case 3:
        info.documentation.push(reader.readString(field.wireType));
        break;
      case 4:
        info.relationships.push(decodeMessage(reader.readBytes(field.wireType), decodeRelationship));
        break;
      case 5:
        info.kind = reader.readVarintForField(field.wireType);
        break;
      case 6:
        info.displayName = reader.readString(field.wireType);
        break;
      case 7:
        info.signature = decodeMessage(reader.readBytes(field.wireType), decodeSignature);
        break;
      case 8:
        info.enclosingSymbol = reader.readString(field.wireType);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return info;
}

function decodeSignature(bytes: Uint8Array): ScipSignature {
  const reader = new ProtoReader(bytes);
  const signature: ScipSignature = { language: '', text: '' };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 4:
        signature.language = reader.readString(field.wireType);
        break;
      case 5:
        signature.text = reader.readString(field.wireType);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return signature;
}

function decodeRelationship(bytes: Uint8Array): ScipRelationship {
  const reader = new ProtoReader(bytes);
  const relationship: ScipRelationship = {
    symbol: '',
    isReference: false,
    isImplementation: false,
    isTypeDefinition: false,
    isDefinition: false,
  };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        relationship.symbol = reader.readString(field.wireType);
        break;
      case 2:
        relationship.isReference = reader.readBool(field.wireType);
        break;
      case 3:
        relationship.isImplementation = reader.readBool(field.wireType);
        break;
      case 4:
        relationship.isTypeDefinition = reader.readBool(field.wireType);
        break;
      case 5:
        relationship.isDefinition = reader.readBool(field.wireType);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return relationship;
}

function decodeOccurrence(bytes: Uint8Array): ScipOccurrence {
  const reader = new ProtoReader(bytes);
  const occurrence: ScipOccurrence = {
    range: [],
    symbol: '',
    symbolRoles: 0,
    syntaxKind: 0,
  };

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        occurrence.range.push(...reader.readInt32List(field.wireType));
        break;
      case 2:
        occurrence.symbol = reader.readString(field.wireType);
        break;
      case 3:
        occurrence.symbolRoles = reader.readVarintForField(field.wireType);
        break;
      case 5:
        occurrence.syntaxKind = reader.readVarintForField(field.wireType);
        break;
      case 8:
        occurrence.range = decodeMessage(reader.readBytes(field.wireType), decodeSingleLineRange);
        break;
      case 9:
        occurrence.range = decodeMessage(reader.readBytes(field.wireType), decodeMultiLineRange);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return occurrence;
}

function decodeSingleLineRange(bytes: Uint8Array): number[] {
  const reader = new ProtoReader(bytes);
  let line = 0;
  let startCharacter = 0;
  let endCharacter = 0;

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        line = reader.readVarintForField(field.wireType);
        break;
      case 2:
        startCharacter = reader.readVarintForField(field.wireType);
        break;
      case 3:
        endCharacter = reader.readVarintForField(field.wireType);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return [line, startCharacter, endCharacter];
}

function decodeMultiLineRange(bytes: Uint8Array): number[] {
  const reader = new ProtoReader(bytes);
  let startLine = 0;
  let startCharacter = 0;
  let endLine = 0;
  let endCharacter = 0;

  while (!reader.eof()) {
    const field = reader.readField();
    switch (field.number) {
      case 1:
        startLine = reader.readVarintForField(field.wireType);
        break;
      case 2:
        startCharacter = reader.readVarintForField(field.wireType);
        break;
      case 3:
        endLine = reader.readVarintForField(field.wireType);
        break;
      case 4:
        endCharacter = reader.readVarintForField(field.wireType);
        break;
      default:
        reader.skip(field.wireType);
    }
  }

  return [startLine, startCharacter, endLine, endCharacter];
}

function decodeMessage<T>(bytes: Uint8Array, decode: (bytes: Uint8Array) => T): T {
  return decode(bytes);
}

interface ProtoField {
  number: number;
  wireType: number;
}

class ProtoReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  eof(): boolean {
    return this.offset >= this.bytes.length;
  }

  readField(): ProtoField {
    const tag = this.readVarint();
    return {
      number: tag >>> 3,
      wireType: tag & 0x7,
    };
  }

  readString(wireType: number): string {
    return Buffer.from(this.readBytes(wireType)).toString('utf-8');
  }

  readBool(wireType: number): boolean {
    return this.readVarintForField(wireType) !== 0;
  }

  readVarintForField(wireType: number): number {
    this.expectWireType(wireType, 0);
    return this.readVarint();
  }

  readInt32List(wireType: number): number[] {
    if (wireType === 0) {
      return [this.readVarint()];
    }
    this.expectWireType(wireType, 2);
    const reader = new ProtoReader(this.readLengthDelimited());
    const values: number[] = [];
    while (!reader.eof()) values.push(reader.readVarint());
    return values;
  }

  readBytes(wireType: number): Uint8Array {
    this.expectWireType(wireType, 2);
    return this.readLengthDelimited();
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0:
        this.readVarint();
        return;
      case 1:
        this.advance(8);
        return;
      case 2: {
        const length = this.readVarint();
        this.advance(length);
        return;
      }
      case 5:
        this.advance(4);
        return;
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
  }

  private readVarint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      if (this.offset >= this.bytes.length) {
        throw new Error('Unexpected end of SCIP protobuf while reading varint');
      }
      const byte = this.bytes[this.offset++]!;
      if (shift < 53) result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) throw new Error('SCIP protobuf varint exceeds safe integer range');
        return result;
      }
      shift += 7;
    }
    throw new Error('Invalid SCIP protobuf varint');
  }

  private readLengthDelimited(): Uint8Array {
    const length = this.readVarint();
    if (length < 0) throw new Error('Invalid negative SCIP protobuf length');
    const start = this.offset;
    this.advance(length);
    return this.bytes.subarray(start, start + length);
  }

  private advance(bytes: number): void {
    if (this.offset + bytes > this.bytes.length) {
      throw new Error('Unexpected end of SCIP protobuf');
    }
    this.offset += bytes;
  }

  private expectWireType(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new Error(`Unexpected SCIP protobuf wire type ${actual}; expected ${expected}`);
    }
  }
}
