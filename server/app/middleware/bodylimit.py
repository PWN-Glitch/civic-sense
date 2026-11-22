"""Reject request bodies over a byte cap before anything parses them.

Starlette spools a whole multipart upload to a temp file before the route runs,
so a size check inside the handler comes too late to stop a huge upload.
"""

from __future__ import annotations

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_DETAIL = "request body too large"


class _BodyTooLarge(HTTPException):
    # An HTTPException so FastAPI's body parser re-raises it instead of turning it into a 400.
    def __init__(self) -> None:
        super().__init__(status_code=413, detail=_DETAIL)


async def _send_413(send: Send) -> None:
    body = b'{"detail":"' + _DETAIL.encode() + b'"}'
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope["headers"]:
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = 0
                if declared > self.max_bytes:
                    await _send_413(send)
                    return

        # Chunked bodies declare no length, so count what actually arrives.
        received = 0
        started = False

        async def capped_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, capped_receive, tracking_send)
        except _BodyTooLarge:
            if started:
                raise
            await _send_413(send)
