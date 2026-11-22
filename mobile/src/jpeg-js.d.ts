/** Minimal typings for jpeg-js, which ships no type declarations. */
declare module 'jpeg-js' {
  export interface DecodeOptions {
    useTArray?: boolean;
    formatAsRGBA?: boolean;
    maxMemoryUsageInMB?: number;
    maxResolutionInMP?: number;
    tolerantDecoding?: boolean;
    colorTransform?: boolean;
  }
  export interface DecodedImage {
    width: number;
    height: number;
    /** RGBA when `formatAsRGBA` (the default), RGB otherwise. */
    data: Uint8Array;
  }
  export function decode(
    data: Uint8Array | ArrayLike<number>,
    options?: DecodeOptions,
  ): DecodedImage;
}
