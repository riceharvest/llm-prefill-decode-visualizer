from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_best_by import GetApiBestBy
from ...models.get_api_best_hw_class import GetApiBestHwClass
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    limit: int | Unset = 10,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_by: str | Unset = UNSET
    if not isinstance(by, Unset):
        json_by = by.value

    params["by"] = json_by

    params["model"] = model

    params["maxParamsB"] = max_params_b

    params["quant"] = quant

    json_hw_class: str | Unset = UNSET
    if not isinstance(hw_class, Unset):
        json_hw_class = hw_class.value

    params["hwClass"] = json_hw_class

    params["hardware"] = hardware

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/best",
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
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    limit: int | Unset = 10,
) -> Response[Any]:
    """Ranked answers: fastest rigs for given constraints

     Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median
    decode speed.

    Args:
        by (GetApiBestBy | Unset):  Default: GetApiBestBy.DECODE.
        model (str | Unset):
        max_params_b (float | Unset):
        quant (str | Unset):
        hw_class (GetApiBestHwClass | Unset):
        hardware (str | Unset):
        limit (int | Unset):  Default: 10.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        by=by,
        model=model,
        max_params_b=max_params_b,
        quant=quant,
        hw_class=hw_class,
        hardware=hardware,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    by: GetApiBestBy | Unset = GetApiBestBy.DECODE,
    model: str | Unset = UNSET,
    max_params_b: float | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBestHwClass | Unset = UNSET,
    hardware: str | Unset = UNSET,
    limit: int | Unset = 10,
) -> Response[Any]:
    """Ranked answers: fastest rigs for given constraints

     Example: /api/best?by=decode&maxParamsB=8&quant=q4_k_m → top rigs for ≤8B models at Q4_K_M by median
    decode speed.

    Args:
        by (GetApiBestBy | Unset):  Default: GetApiBestBy.DECODE.
        model (str | Unset):
        max_params_b (float | Unset):
        quant (str | Unset):
        hw_class (GetApiBestHwClass | Unset):
        hardware (str | Unset):
        limit (int | Unset):  Default: 10.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        by=by,
        model=model,
        max_params_b=max_params_b,
        quant=quant,
        hw_class=hw_class,
        hardware=hardware,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
