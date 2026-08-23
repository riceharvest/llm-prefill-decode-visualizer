from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.get_sizing_recommendation_hw_class import GetSizingRecommendationHwClass
from ...types import UNSET, Unset



def _get_kwargs(
    *,
    model: str,
    context_length: int | Unset = 8192,
    concurrency: int | Unset = 1,
    prompt_tokens: int | Unset = 2048,
    output_tokens: int | Unset = 512,
    max_ttft_seconds: float | Unset = UNSET,
    max_tpot_ms: float | Unset = UNSET,
    max_vram_gb: float | Unset = UNSET,
    num_layers: int | Unset = UNSET,
    kv_heads: int | Unset = UNSET,
    head_dim: int | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetSizingRecommendationHwClass | Unset = UNSET,
    limit: int | Unset = 5,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["model"] = model

    params["contextLength"] = context_length

    params["concurrency"] = concurrency

    params["promptTokens"] = prompt_tokens

    params["outputTokens"] = output_tokens

    params["maxTtftSeconds"] = max_ttft_seconds

    params["maxTpotMs"] = max_tpot_ms

    params["maxVramGb"] = max_vram_gb

    params["numLayers"] = num_layers

    params["kvHeads"] = kv_heads

    params["headDim"] = head_dim

    params["quant"] = quant

    json_hw_class: str | Unset = UNSET
    if not isinstance(hw_class, Unset):
        json_hw_class = hw_class.value

    params["hwClass"] = json_hw_class

    params["limit"] = limit


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/sizing",
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
    model: str,
    context_length: int | Unset = 8192,
    concurrency: int | Unset = 1,
    prompt_tokens: int | Unset = 2048,
    output_tokens: int | Unset = 512,
    max_ttft_seconds: float | Unset = UNSET,
    max_tpot_ms: float | Unset = UNSET,
    max_vram_gb: float | Unset = UNSET,
    num_layers: int | Unset = UNSET,
    kv_heads: int | Unset = UNSET,
    head_dim: int | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetSizingRecommendationHwClass | Unset = UNSET,
    limit: int | Unset = 5,

) -> Response[Any]:
    """ Hardware sizing recommendation for a workload spec (VRAM fit + expected TTFT/TPOT)

     One canonical query for deployment planning: pass a workload spec, get ranked rigs with required-
    VRAM math (weights + KV cache at target context × concurrency + overhead) and expected TTFT/TPOT
    from aggregated benchmark medians, plus per-group sample confidence.

    Args:
        model (str):
        context_length (int | Unset):  Default: 8192.
        concurrency (int | Unset):  Default: 1.
        prompt_tokens (int | Unset):  Default: 2048.
        output_tokens (int | Unset):  Default: 512.
        max_ttft_seconds (float | Unset):
        max_tpot_ms (float | Unset):
        max_vram_gb (float | Unset):
        num_layers (int | Unset):
        kv_heads (int | Unset):
        head_dim (int | Unset):
        quant (str | Unset):
        hw_class (GetSizingRecommendationHwClass | Unset):
        limit (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
     """


    kwargs = _get_kwargs(
        model=model,
context_length=context_length,
concurrency=concurrency,
prompt_tokens=prompt_tokens,
output_tokens=output_tokens,
max_ttft_seconds=max_ttft_seconds,
max_tpot_ms=max_tpot_ms,
max_vram_gb=max_vram_gb,
num_layers=num_layers,
kv_heads=kv_heads,
head_dim=head_dim,
quant=quant,
hw_class=hw_class,
limit=limit,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    model: str,
    context_length: int | Unset = 8192,
    concurrency: int | Unset = 1,
    prompt_tokens: int | Unset = 2048,
    output_tokens: int | Unset = 512,
    max_ttft_seconds: float | Unset = UNSET,
    max_tpot_ms: float | Unset = UNSET,
    max_vram_gb: float | Unset = UNSET,
    num_layers: int | Unset = UNSET,
    kv_heads: int | Unset = UNSET,
    head_dim: int | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetSizingRecommendationHwClass | Unset = UNSET,
    limit: int | Unset = 5,

) -> Response[Any]:
    """ Hardware sizing recommendation for a workload spec (VRAM fit + expected TTFT/TPOT)

     One canonical query for deployment planning: pass a workload spec, get ranked rigs with required-
    VRAM math (weights + KV cache at target context × concurrency + overhead) and expected TTFT/TPOT
    from aggregated benchmark medians, plus per-group sample confidence.

    Args:
        model (str):
        context_length (int | Unset):  Default: 8192.
        concurrency (int | Unset):  Default: 1.
        prompt_tokens (int | Unset):  Default: 2048.
        output_tokens (int | Unset):  Default: 512.
        max_ttft_seconds (float | Unset):
        max_tpot_ms (float | Unset):
        max_vram_gb (float | Unset):
        num_layers (int | Unset):
        kv_heads (int | Unset):
        head_dim (int | Unset):
        quant (str | Unset):
        hw_class (GetSizingRecommendationHwClass | Unset):
        limit (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
     """


    kwargs = _get_kwargs(
        model=model,
context_length=context_length,
concurrency=concurrency,
prompt_tokens=prompt_tokens,
output_tokens=output_tokens,
max_ttft_seconds=max_ttft_seconds,
max_tpot_ms=max_tpot_ms,
max_vram_gb=max_vram_gb,
num_layers=num_layers,
kv_heads=kv_heads,
head_dim=head_dim,
quant=quant,
hw_class=hw_class,
limit=limit,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

