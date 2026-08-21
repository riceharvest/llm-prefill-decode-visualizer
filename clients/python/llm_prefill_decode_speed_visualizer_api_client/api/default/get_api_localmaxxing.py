from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.get_api_localmaxxing_context_band import GetApiLocalmaxxingContextBand
from ...models.get_api_localmaxxing_response_429 import GetApiLocalmaxxingResponse429
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    context_band: GetApiLocalmaxxingContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["hardware"] = hardware

    params["model"] = model

    params["quant"] = quant

    json_context_band: str | Unset = UNSET
    if not isinstance(context_band, Unset):
        json_context_band = context_band.value

    params["context_band"] = json_context_band

    params["limit"] = limit

    params["cursor"] = cursor

    params["snapshot"] = snapshot


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/localmaxxing",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | GetApiLocalmaxxingResponse429 | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 429:
        response_429 = GetApiLocalmaxxingResponse429.from_dict(response.json())



        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | GetApiLocalmaxxingResponse429]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    context_band: GetApiLocalmaxxingContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> Response[Any | GetApiLocalmaxxingResponse429]:
    """ Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (GetApiLocalmaxxingContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiLocalmaxxingResponse429]
     """


    kwargs = _get_kwargs(
        hardware=hardware,
model=model,
quant=quant,
context_band=context_band,
limit=limit,
cursor=cursor,
snapshot=snapshot,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    context_band: GetApiLocalmaxxingContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> Any | GetApiLocalmaxxingResponse429 | None:
    """ Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (GetApiLocalmaxxingContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiLocalmaxxingResponse429
     """


    return sync_detailed(
        client=client,
hardware=hardware,
model=model,
quant=quant,
context_band=context_band,
limit=limit,
cursor=cursor,
snapshot=snapshot,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    context_band: GetApiLocalmaxxingContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> Response[Any | GetApiLocalmaxxingResponse429]:
    """ Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (GetApiLocalmaxxingContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiLocalmaxxingResponse429]
     """


    kwargs = _get_kwargs(
        hardware=hardware,
model=model,
quant=quant,
context_band=context_band,
limit=limit,
cursor=cursor,
snapshot=snapshot,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    context_band: GetApiLocalmaxxingContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> Any | GetApiLocalmaxxingResponse429 | None:
    """ Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (GetApiLocalmaxxingContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiLocalmaxxingResponse429
     """


    return (await asyncio_detailed(
        client=client,
hardware=hardware,
model=model,
quant=quant,
context_band=context_band,
limit=limit,
cursor=cursor,
snapshot=snapshot,

    )).parsed
