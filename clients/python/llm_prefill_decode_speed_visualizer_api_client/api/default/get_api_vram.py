from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    hf_id: str,
    context: int | Unset = 32768,
    quant: str | Unset = "q4_k_m",
    batch_size: int | Unset = 1,
    kv_precision_bytes: float | Unset = 2.0,
    vram_gb: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    tokens_per_turn: float | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["hfId"] = hf_id

    params["context"] = context

    params["quant"] = quant

    params["batchSize"] = batch_size

    params["kvPrecisionBytes"] = kv_precision_bytes

    params["vramGb"] = vram_gb

    params["numTurns"] = num_turns

    params["tokensPerTurn"] = tokens_per_turn

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/vram",
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if response.status_code == 200:
        return None

    if response.status_code == 400:
        return None

    if response.status_code == 404:
        return None

    if response.status_code == 422:
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
    hf_id: str,
    context: int | Unset = 32768,
    quant: str | Unset = "q4_k_m",
    batch_size: int | Unset = 1,
    kv_precision_bytes: float | Unset = 2.0,
    vram_gb: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    tokens_per_turn: float | Unset = UNSET,
) -> Response[Any]:
    r"""Combined model + KV-cache + context VRAM from just an hfId

     Resolves layers, hidden dim, GQA heads, head dim and weight size from the Hugging Face config
    automatically — no architecture params needed. Answers \"will this rig OOM at 64k?\". Optional
    vramGb budget returns a fits flag plus the max context that fits; optional numTurns+tokensPerTurn
    projects per-turn KV growth with the exact overflow turn.

    Args:
        hf_id (str):
        context (int | Unset):  Default: 32768.
        quant (str | Unset):  Default: 'q4_k_m'.
        batch_size (int | Unset):  Default: 1.
        kv_precision_bytes (float | Unset):  Default: 2.0.
        vram_gb (float | Unset):
        num_turns (int | Unset):
        tokens_per_turn (float | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        hf_id=hf_id,
        context=context,
        quant=quant,
        batch_size=batch_size,
        kv_precision_bytes=kv_precision_bytes,
        vram_gb=vram_gb,
        num_turns=num_turns,
        tokens_per_turn=tokens_per_turn,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    hf_id: str,
    context: int | Unset = 32768,
    quant: str | Unset = "q4_k_m",
    batch_size: int | Unset = 1,
    kv_precision_bytes: float | Unset = 2.0,
    vram_gb: float | Unset = UNSET,
    num_turns: int | Unset = UNSET,
    tokens_per_turn: float | Unset = UNSET,
) -> Response[Any]:
    r"""Combined model + KV-cache + context VRAM from just an hfId

     Resolves layers, hidden dim, GQA heads, head dim and weight size from the Hugging Face config
    automatically — no architecture params needed. Answers \"will this rig OOM at 64k?\". Optional
    vramGb budget returns a fits flag plus the max context that fits; optional numTurns+tokensPerTurn
    projects per-turn KV growth with the exact overflow turn.

    Args:
        hf_id (str):
        context (int | Unset):  Default: 32768.
        quant (str | Unset):  Default: 'q4_k_m'.
        batch_size (int | Unset):  Default: 1.
        kv_precision_bytes (float | Unset):  Default: 2.0.
        vram_gb (float | Unset):
        num_turns (int | Unset):
        tokens_per_turn (float | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        hf_id=hf_id,
        context=context,
        quant=quant,
        batch_size=batch_size,
        kv_precision_bytes=kv_precision_bytes,
        vram_gb=vram_gb,
        num_turns=num_turns,
        tokens_per_turn=tokens_per_turn,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
