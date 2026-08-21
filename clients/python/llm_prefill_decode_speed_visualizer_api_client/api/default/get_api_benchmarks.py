from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_benchmarks_group_by import GetApiBenchmarksGroupBy
from ...models.get_api_benchmarks_hw_class import GetApiBenchmarksHwClass
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    group_by: GetApiBenchmarksGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBenchmarksHwClass | Unset = UNSET,
    limit: int | Unset = 25,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_group_by: str | Unset = UNSET
    if not isinstance(group_by, Unset):
        json_group_by = group_by.value

    params["groupBy"] = json_group_by

    params["hardware"] = hardware

    params["model"] = model

    params["quant"] = quant

    json_hw_class: str | Unset = UNSET
    if not isinstance(hw_class, Unset):
        json_hw_class = hw_class.value

    params["hwClass"] = json_hw_class

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/benchmarks",
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
    group_by: GetApiBenchmarksGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBenchmarksHwClass | Unset = UNSET,
    limit: int | Unset = 25,
) -> Response[Any]:
    """Aggregated speeds: median + IQR per group

     Outlier-resistant stats per hardware×model-family group (default). Regroup with
    ?groupBy=hardware|model|quant.

    Args:
        group_by (GetApiBenchmarksGroupBy | Unset):
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        hw_class (GetApiBenchmarksHwClass | Unset):
        limit (int | Unset):  Default: 25.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        group_by=group_by,
        hardware=hardware,
        model=model,
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
    group_by: GetApiBenchmarksGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetApiBenchmarksHwClass | Unset = UNSET,
    limit: int | Unset = 25,
) -> Response[Any]:
    """Aggregated speeds: median + IQR per group

     Outlier-resistant stats per hardware×model-family group (default). Regroup with
    ?groupBy=hardware|model|quant.

    Args:
        group_by (GetApiBenchmarksGroupBy | Unset):
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        hw_class (GetApiBenchmarksHwClass | Unset):
        limit (int | Unset):  Default: 25.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
    """

    kwargs = _get_kwargs(
        group_by=group_by,
        hardware=hardware,
        model=model,
        quant=quant,
        hw_class=hw_class,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)
