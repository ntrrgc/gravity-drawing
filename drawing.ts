const canvasWidth = 640 * devicePixelRatio, canvasHeight = 480 * devicePixelRatio;
const canvasCursorRenderer = <HTMLCanvasElement>document.getElementById("cursor-renderer");
const canvasUserDrawing = <HTMLCanvasElement>document.getElementById("user-drawing");
const canvasGravityHud = <HTMLCanvasElement>document.getElementById("gravity-hud");

for (let canvas of [canvasCursorRenderer, canvasUserDrawing, canvasGravityHud]) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.getContext("2d").clearRect(0, 0, canvasWidth, canvasHeight);
    canvas.getContext("2d").translate(-.5, -.5);
    canvas.style.width = canvasWidth / devicePixelRatio + "px";
    canvas.style.height = canvasHeight / devicePixelRatio + "px";
}

let canvasContainer = document.getElementById("canvas-container");
canvasContainer.style.width = canvasWidth / devicePixelRatio + "px";
canvasContainer.style.height = canvasHeight / devicePixelRatio + "px";
const canvasRect = canvasContainer.getBoundingClientRect();

interface Point {x: number, y:number}
function newPoint(): Point {
    return {x: 0, y: 0};
}

class DrawingSegment {
    constructor(public ax: number, public ay: number, public bx: number, public by: number) {}

    stroke(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.moveTo(this.ax, this.ay);
        ctx.lineTo(this.bx, this.by);
        ctx.stroke();
    }
}

class DrawingAction {
    segments: DrawingSegment[] = [];

    replay(ctx: CanvasRenderingContext2D) {
        for (let segment of this.segments) {
            segment.stroke(ctx);
        }
    }
}

class DrawingUndoStack {
    private stack: DrawingAction[] = [];
    private headIndex: number = 0; // non-inclusive

    canUndo() {
        return this.headIndex > 0;
    }

    canRedo() {
        return this.headIndex < this.stack.length;
    }

    updateUiButtons() {
        // Update UI buttons
        const btnUndo = <HTMLInputElement>document.getElementById("btnUndo");
        const btnRedo = <HTMLInputElement>document.getElementById("btnRedo");

        btnUndo.disabled = !this.canUndo();
        btnRedo.disabled = !this.canRedo();
    }

    pushNewAction(drawingAction: DrawingAction) {
        // Clear everything previously undone in the stack
        this.stack.splice(this.headIndex, this.stack.length - this.headIndex);
        if (this.stack.length != this.headIndex)
            throw new Error("Assertion error");

        // Push the new action and update head pointer
        this.stack.push(drawingAction);
        this.headIndex++;

        // Update UI buttons
        this.updateUiButtons();
    }

    private replayCanvas(headIndex: number) {
        const ctx = canvasUserDrawing.getContext("2d");
        clearCanvas(ctx);

        for (let actionIndex = 0; actionIndex < this.headIndex; actionIndex++) {
            const action = this.stack[actionIndex];
            action.replay(ctx);
        }
    }

    undo() {
        if (this.headIndex <= 0)
            throw new Error("Can't undo");

        this.headIndex--;
        this.replayCanvas(this.headIndex);
        this.updateUiButtons();
    }

    undoAll() {
        this.headIndex = 0;
        this.replayCanvas(this.headIndex);
        this.updateUiButtons();
    }

    redo() {
        if (this.headIndex >= this.stack.length)
            throw new Error("Can't redo");

        this.headIndex++;
        this.replayCanvas(this.headIndex);
        this.updateUiButtons();
    }
}

const drawingUndoStack = new DrawingUndoStack();

const gravityCenter: Point = {x: canvasWidth / 2, y: canvasHeight / 2};
let gravityHoleRadius = -1; // to force initial update
let gravityForceRadius = -1; // to force initial update

// Convert event.pageX into coordinates of the canvas
function rawClientPosToCanvasPos(destPoint: Point, rawPageX: number, rawPageY: number) {
    const beforeTransformX = Math.round((rawPageX - canvasRect.left) * devicePixelRatio);
    const beforeTransformY = Math.round((rawPageY - canvasRect.top) * devicePixelRatio);
    transformCursorPosition(destPoint, beforeTransformX, beforeTransformY);
    return destPoint;
}

function addCursorMovementListener(listener: (x: number, y: number) => void) {
    const cachePoint: Point = newPoint();
    if ("PointerEvent" in window && "getCoalescedEvents" in PointerEvent.prototype) {
        canvasCursorRenderer.addEventListener("pointermove", (ev) => {
            const coalescedEvents: PointerEvent[] = (<any>ev).getCoalescedEvents();
            // Trigger only last event
            const lastEvent = coalescedEvents[coalescedEvents.length - 1];
            rawClientPosToCanvasPos(cachePoint, lastEvent.pageX, lastEvent.pageY);
            listener(cachePoint.x, cachePoint.y);
        })
    } else {
        canvasCursorRenderer.addEventListener("mousemove", (event) => {
            rawClientPosToCanvasPos(cachePoint, event.pageX, event.pageY);
            listener(cachePoint.x, cachePoint.y);
        });
    }
}

interface DrawingActionListener {
    pointerMoved(newCanvasPos: Point): void;
    actionFinished(): void;
}

interface DrawingActionListenerFactory {
    drawingActionStarted(startCanvasPos: Point): DrawingActionListener;
}

interface EventDisconnector {
    disconnectEventListener(): void;
}

function addImprovedMouseMoveListener(node: Node, listener: (ev: MouseEvent) => void): EventDisconnector {
    if ("PointerEvent" in window && "getCoalescedEvents" in PointerEvent.prototype) {
        function pointerMoveListener(ev: MouseEvent) {
            const coalescedEvents: PointerEvent[] = (<any>ev).getCoalescedEvents();
            for (let event of coalescedEvents) {
                listener(event);
            }
        }

        node.addEventListener("pointermove", pointerMoveListener);
        return {
            disconnectEventListener() {
                node.removeEventListener("pointermove", pointerMoveListener);
            }
        }
    } else {
        function mouseMoveListener(ev: MouseEvent) {
            listener(ev);
        }

        node.addEventListener("mousemove", mouseMoveListener);
        return {
            disconnectEventListener() {
                node.removeEventListener("mousemove", mouseMoveListener);
            }
        }
    }
}

function addDrawingListener(drawingActionListenerFactory: DrawingActionListenerFactory) {
    // Mouse and pen handler
    canvasCursorRenderer.addEventListener("mousedown", ev => {
        if (ev.button != 0)
            return;

        const currentMouseDrawingAction = drawingActionListenerFactory.drawingActionStarted(
            rawClientPosToCanvasPos(newPoint(), ev.pageX, ev.pageY));

        const mouseMoveListenerDisconnector = addImprovedMouseMoveListener(document, ev => {
            const canvasPos = rawClientPosToCanvasPos(newPoint(), ev.pageX, ev.pageY);
            currentMouseDrawingAction.pointerMoved(canvasPos);
        });

        document.addEventListener("mouseup", function mouseUpListener(ev) {
            if (ev.button == 0) {
                currentMouseDrawingAction.actionFinished();
                document.removeEventListener("mouseup", mouseUpListener);
                mouseMoveListenerDisconnector.disconnectEventListener();
            }
        });
    });

    // Touch handler
    const touchDrawingActionMap = new Map<number, DrawingActionListener>();
    canvasCursorRenderer.addEventListener("touchstart", ev => {
        ev.preventDefault();
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const touch = ev.changedTouches.item(i);

            const canvasPos = rawClientPosToCanvasPos(newPoint(), touch.pageX, touch.pageY);
            touchDrawingActionMap.set(touch.identifier, drawingActionListenerFactory.drawingActionStarted(canvasPos));
        }
    });
    canvasCursorRenderer.addEventListener("touchend", ev => {
        ev.preventDefault();
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const touch = ev.changedTouches.item(i);

            touchDrawingActionMap.get(touch.identifier)!.actionFinished();
            touchDrawingActionMap.delete(touch.identifier);
        }
    });
    canvasCursorRenderer.addEventListener("touchmove", ev => {
        ev.preventDefault();
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const touch = ev.changedTouches.item(i);

            const canvasPos = rawClientPosToCanvasPos(newPoint(), touch.pageX, touch.pageY);
            touchDrawingActionMap.get(touch.identifier)!.pointerMoved(canvasPos);
        }
    });
}

function clearCanvas(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(-2, -2, canvasWidth + 4, canvasHeight + 4);
}

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, crossRadius: number) {
    const topY = y - crossRadius;
    const bottomY = y + crossRadius;
    const topBottomX = x;

    const leftX = x - crossRadius;
    const rightX = x + crossRadius;
    const leftRightY = y;

    ctx.beginPath();
    ctx.moveTo(topBottomX, topY);
    ctx.lineTo(topBottomX, bottomY);
    ctx.moveTo(leftX, leftRightY);
    ctx.lineTo(rightX, leftRightY);
    ctx.stroke();
}

function drawCanvasGravityHud() {
    const ctx = canvasGravityHud.getContext("2d");
    clearCanvas(ctx);
    ctx.strokeStyle = "#AAAAAA";

    drawCrosshair(ctx, gravityCenter.x, gravityCenter.y, 2);

    ctx.beginPath();
    ctx.arc(gravityCenter.x, gravityCenter.y, gravityHoleRadius, 0, 360);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(gravityCenter.x, gravityCenter.y, gravityForceRadius, 0, 360);
    ctx.stroke();
}

function transformCursorPosition(ret: Point, x: number, y: number): Point {

    const vx = x - gravityCenter.x;
    const vy = y - gravityCenter.y;
    const d = Math.sqrt(vx * vx + vy * vy);

    if (d <= gravityHoleRadius) {
        // Inside the black hole
        ret.x = gravityCenter.x;
        ret.y = gravityCenter.y;
    } else if (d < gravityForceRadius) {
        // Near the black hole
        const angle = Math.atan2(vy, vx);

        const t = (d - gravityHoleRadius) / (gravityForceRadius - gravityHoleRadius);
        const newD = t * gravityForceRadius;

        ret.x = gravityCenter.x + Math.cos(angle) * newD;
        ret.y = gravityCenter.y + Math.sin(angle) * newD;
    } else {
        // Unaffected by gravity.
        ret.x = x;
        ret.y = y;
    }

    return ret;
}

let lastCursorPosition: Point|null;
addCursorMovementListener((x, y) => {
    // Draw crosshair
    const ctx = canvasCursorRenderer.getContext("2d");
    const crossRadius = 3;

    if (lastCursorPosition != null) {
        ctx.clearRect(lastCursorPosition.x - crossRadius - 1,
            lastCursorPosition.y - crossRadius - 1,
            crossRadius * 2 + 2, crossRadius * 2 + 2);
    }

    // Draw new crosshair
    drawCrosshair(ctx, x, y, 3);

    if (lastCursorPosition == null) {
        lastCursorPosition = {x: 0, y: 0};
    }
    lastCursorPosition.x = x;
    lastCursorPosition.y = y;
});

addDrawingListener({
    drawingActionStarted: (startCanvasPos) => {
        const ctx = canvasUserDrawing.getContext("2d");
        let previousCanvasPos = startCanvasPos;
        const drawingAction = new DrawingAction();

        return {
            pointerMoved(newCanvasPos: Point) {
                const segment = new DrawingSegment(previousCanvasPos.x, previousCanvasPos.y, newCanvasPos.x, newCanvasPos.y);
                segment.stroke(ctx);
                drawingAction.segments.push(segment);
                previousCanvasPos = newCanvasPos;
            },
            actionFinished() {
                drawingUndoStack.pushNewAction(drawingAction);
            }
        };
    }
});

function clearUserDrawingCanvas() {
    drawingUndoStack.undoAll();
}

function updatedOptions() {
    const newHideCursor = (<HTMLInputElement>document.getElementById("chkHideCursor")).checked;
    canvasContainer.style.cursor = newHideCursor ? "none" : "inherit";

    const newHoleRadius = parseFloat((<HTMLInputElement>document.getElementById("sldHoleRadius")).value) * devicePixelRatio;
    const newForceRadius = Math.max(newHoleRadius, parseFloat((<HTMLInputElement>document.getElementById("sldForceRadius")).value) * devicePixelRatio);

    if (newHoleRadius != gravityHoleRadius || newForceRadius != gravityForceRadius) {
        gravityHoleRadius = newHoleRadius;
        gravityForceRadius = newForceRadius;
        drawCanvasGravityHud();
    }
}

updatedOptions();
drawingUndoStack.updateUiButtons();

document.addEventListener("keydown", ev => {
    if (ev.keyCode == 90 && drawingUndoStack.canUndo()) { // Z
        ev.preventDefault();
        drawingUndoStack.undo();
    } else if (ev.keyCode == 89 && drawingUndoStack.canRedo()) { // Y
        ev.preventDefault();
        drawingUndoStack.redo();
    }
});