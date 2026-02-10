
export enum Tool {
  SELECT = 'SELECT',
  LINE = 'LINE',
  ARROW = 'ARROW',
  RECTANGLE = 'RECTANGLE',
  COPY_REGION = 'COPY_REGION',
  PASTE = 'PASTE',
  ERASER = 'ERASER',
  BLUR = 'BLUR',
  PIXELATE = 'PIXELATE'
}

export interface Point {
  x: number;
  y: number;
}

export interface Selection {
  start: Point;
  end: Point;
}

export interface PastedRegion {
  id: string;
  imageData: ImageData;
  position: Point;
  width: number;
  height: number;
}

export interface DrawingAction {
  id: string;
  tool: Tool;
  points: Point[];
  color: string;
  lineWidth: number;
  intensity?: number;
}
