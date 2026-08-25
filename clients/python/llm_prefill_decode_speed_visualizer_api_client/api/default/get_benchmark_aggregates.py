from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.benchmark_group_list_envelope import BenchmarkGroupListEnvelope
from ...models.get_benchmark_aggregates_context_band import GetBenchmarkAggregatesContextBand
from ...models.get_benchmark_aggregates_group_by import GetBenchmarkAggregatesGroupBy
from ...models.get_benchmark_aggregates_hw_class import GetBenchmarkAggregatesHwClass
from ...models.get_benchmark_aggregates_response_429 import GetBenchmarkAggregatesResponse429
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    group_by: GetBenchmarkAggregatesGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetBenchmarkAggregatesHwClass | Unset = UNSET,
    context_band: GetBenchmarkAggregatesContextBand | Unset = UNSET,
    limit: int | Unset = 25,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

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
        "url": "/api/benchmarks",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429 | None:
    if response.status_code == 200:
        response_200 = BenchmarkGroupListEnvelope.from_dict(response.json())



        return response_200

    if response.status_code == 429:
        response_429 = GetBenchmarkAggregatesResponse429.from_dict(response.json())



        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    group_by: GetBenchmarkAggregatesGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetBenchmarkAggregatesHwClass | Unset = UNSET,
    context_band: GetBenchmarkAggregatesContextBand | Unset = UNSET,
    limit: int | Unset = 25,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> Response[BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429]:
    r""" Aggregated speeds: median + IQR + 95% bootstrap CI per group

     Outlier-resistant stats per hardware×model-family group (default). Each median carries a 95%
    percentile bootstrap confidence interval (2,000 resamples) in ci95 {lo, hi}, plus a \"median
    [lo–hi]\" label string. Regroup with ?groupBy=hardware|model|quant. Cursor-paginated: { total,
    items[], has_more, next_cursor } sorted by median decode desc (group key tiebreak). Each group
    carries confidence {runs, iqrSpreadPct, outliers, newestRunAgeDays, grade} and cross_check
    {relatedRigComparisons, contradictions[]} comparing multi-GPU rigs against the single-GPU baseline
    on the same model/quant.

    Args:
        group_by (GetBenchmarkAggregatesGroupBy | Unset):
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        hw_class (GetBenchmarkAggregatesHwClass | Unset):
        context_band (GetBenchmarkAggregatesContextBand | Unset):
        limit (int | Unset):  Default: 25.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429]
     """


    kwargs = _get_kwargs(
        group_by=group_by,
hardware=hardware,
model=model,
quant=quant,
hw_class=hw_class,
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
    group_by: GetBenchmarkAggregatesGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetBenchmarkAggregatesHwClass | Unset = UNSET,
    context_band: GetBenchmarkAggregatesContextBand | Unset = UNSET,
    limit: int | Unset = 25,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429 | None:
    r""" Aggregated speeds: median + IQR + 95% bootstrap CI per group

     Outlier-resistant stats per hardware×model-family group (default). Each median carries a 95%
    percentile bootstrap confidence interval (2,000 resamples) in ci95 {lo, hi}, plus a \"median
    [lo–hi]\" label string. Regroup with ?groupBy=hardware|model|quant. Cursor-paginated: { total,
    items[], has_more, next_cursor } sorted by median decode desc (group key tiebreak). Each group
    carries confidence {runs, iqrSpreadPct, outliers, newestRunAgeDays, grade} and cross_check
    {relatedRigComparisons, contradictions[]} comparing multi-GPU rigs against the single-GPU baseline
    on the same model/quant.

    Args:
        group_by (GetBenchmarkAggregatesGroupBy | Unset):
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        hw_class (GetBenchmarkAggregatesHwClass | Unset):
        context_band (GetBenchmarkAggregatesContextBand | Unset):
        limit (int | Unset):  Default: 25.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429
     """


    return sync_detailed(
        client=client,
group_by=group_by,
hardware=hardware,
model=model,
quant=quant,
hw_class=hw_class,
context_band=context_band,
limit=limit,
cursor=cursor,
snapshot=snapshot,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    group_by: GetBenchmarkAggregatesGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetBenchmarkAggregatesHwClass | Unset = UNSET,
    context_band: GetBenchmarkAggregatesContextBand | Unset = UNSET,
    limit: int | Unset = 25,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> Response[BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429]:
    r""" Aggregated speeds: median + IQR + 95% bootstrap CI per group

     Outlier-resistant stats per hardware×model-family group (default). Each median carries a 95%
    percentile bootstrap confidence interval (2,000 resamples) in ci95 {lo, hi}, plus a \"median
    [lo–hi]\" label string. Regroup with ?groupBy=hardware|model|quant. Cursor-paginated: { total,
    items[], has_more, next_cursor } sorted by median decode desc (group key tiebreak). Each group
    carries confidence {runs, iqrSpreadPct, outliers, newestRunAgeDays, grade} and cross_check
    {relatedRigComparisons, contradictions[]} comparing multi-GPU rigs against the single-GPU baseline
    on the same model/quant.

    Args:
        group_by (GetBenchmarkAggregatesGroupBy | Unset):
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        hw_class (GetBenchmarkAggregatesHwClass | Unset):
        context_band (GetBenchmarkAggregatesContextBand | Unset):
        limit (int | Unset):  Default: 25.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429]
     """


    kwargs = _get_kwargs(
        group_by=group_by,
hardware=hardware,
model=model,
quant=quant,
hw_class=hw_class,
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
    group_by: GetBenchmarkAggregatesGroupBy | Unset = UNSET,
    hardware: str | Unset = UNSET,
    model: str | Unset = UNSET,
    quant: str | Unset = UNSET,
    hw_class: GetBenchmarkAggregatesHwClass | Unset = UNSET,
    context_band: GetBenchmarkAggregatesContextBand | Unset = UNSET,
    limit: int | Unset = 25,
    cursor: str | Unset = UNSET,
    snapshot: str | Unset = UNSET,

) -> BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429 | None:
    r""" Aggregated speeds: median + IQR + 95% bootstrap CI per group

     Outlier-resistant stats per hardware×model-family group (default). Each median carries a 95%
    percentile bootstrap confidence interval (2,000 resamples) in ci95 {lo, hi}, plus a \"median
    [lo–hi]\" label string. Regroup with ?groupBy=hardware|model|quant. Cursor-paginated: { total,
    items[], has_more, next_cursor } sorted by median decode desc (group key tiebreak). Each group
    carries confidence {runs, iqrSpreadPct, outliers, newestRunAgeDays, grade} and cross_check
    {relatedRigComparisons, contradictions[]} comparing multi-GPU rigs against the single-GPU baseline
    on the same model/quant.

    Args:
        group_by (GetBenchmarkAggregatesGroupBy | Unset):
        hardware (str | Unset):
        model (str | Unset):
        quant (str | Unset):
        hw_class (GetBenchmarkAggregatesHwClass | Unset):
        context_band (GetBenchmarkAggregatesContextBand | Unset):
        limit (int | Unset):  Default: 25.
        cursor (str | Unset):
        snapshot (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BenchmarkGroupListEnvelope | GetBenchmarkAggregatesResponse429
     """


    return (await asyncio_detailed(
        client=client,
group_by=group_by,
hardware=hardware,
model=model,
quant=quant,
hw_class=hw_class,
context_band=context_band,
limit=limit,
cursor=cursor,
snapshot=snapshot,

    )).parsed
