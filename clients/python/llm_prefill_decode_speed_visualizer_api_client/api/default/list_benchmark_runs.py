from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.hardware_summary_envelope import HardwareSummaryEnvelope
from ...models.list_benchmark_runs_context_band import ListBenchmarkRunsContextBand
from ...models.list_benchmark_runs_response_429 import ListBenchmarkRunsResponse429
from ...models.run_list_envelope import RunListEnvelope
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    context_band: ListBenchmarkRunsContextBand | Unset = UNSET,
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


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429 | None:
    if response.status_code == 200:

        def _parse_response_200(data: object) -> HardwareSummaryEnvelope | RunListEnvelope:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = RunListEnvelope.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = HardwareSummaryEnvelope.from_dict(data)

            return response_200_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 429:
        response_429 = ListBenchmarkRunsResponse429.from_dict(response.json())

        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429]:
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
    context_band: ListBenchmarkRunsContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,
) -> Response[HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429]:
    """Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (ListBenchmarkRunsContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429]
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
    context_band: ListBenchmarkRunsContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,
) -> HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429 | None:
    """Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (ListBenchmarkRunsContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429
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
    context_band: ListBenchmarkRunsContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,
) -> Response[HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429]:
    """Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (ListBenchmarkRunsContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429]
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

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    context_band: ListBenchmarkRunsContextBand | Unset = UNSET,
    limit: int | Unset = 50,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,
) -> HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429 | None:
    """Raw community benchmark runs (flattened, model-normalized)

     Bare call returns a hardware-group summary. With any filter, returns a cursor-paginated run list: {
    total, items[], has_more, next_cursor } sorted by decode speed desc (runId tiebreak) — follow
    next_cursor until has_more is false.

    Args:
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        context_band (ListBenchmarkRunsContextBand | Unset):
        limit (int | Unset):  Default: 50.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        HardwareSummaryEnvelope | RunListEnvelope | ListBenchmarkRunsResponse429
    """

    return (
        await asyncio_detailed(
            client=client,
            hardware=hardware,
            model=model,
            quant=quant,
            context_band=context_band,
            limit=limit,
            cursor=cursor,
            snapshot=snapshot,
        )
    ).parsed
