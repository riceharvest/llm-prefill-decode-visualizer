from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["hardware"] = hardware

    params["model"] = model

    params["quant"] = quant

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/localmaxxing",
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if response.status_code == 200:
        return None

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any]:
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
    limit: int | Unset = 50,
) -> Response[Any]:
    """Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. Filters:
    ?hardware=<substr>&model=<substr>&quant=<exact>&limit=N. Runs carry measured prefillTokPerSec /
    decodeTokPerSec.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        hardware=hardware,
        model=model,
        quant=quant,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[Any]:
    """Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. Filters:
    ?hardware=<substr>&model=<substr>&quant=<exact>&limit=N. Runs carry measured prefillTokPerSec /
    decodeTokPerSec.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        hardware=hardware,
        model=model,
        quant=quant,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
