from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.get_api_runs_comparable import GetApiRunsComparable
from ...models.get_api_runs_format import GetApiRunsFormat
from ...models.problem import Problem
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    format_: GetApiRunsFormat | Unset = GetApiRunsFormat.JSON,
    comparable: GetApiRunsComparable | Unset = GetApiRunsComparable.ALL,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    json_format_: str | Unset = UNSET
    if not isinstance(format_, Unset):
        json_format_ = format_.value

    params["format"] = json_format_

    json_comparable: str | Unset = UNSET
    if not isinstance(comparable, Unset):
        json_comparable = comparable.value

    params["comparable"] = json_comparable


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/runs",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | Problem | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 400:
        response_400 = Problem.from_dict(response.json())



        return response_400

    if response.status_code == 405:
        response_405 = Problem.from_dict(response.json())



        return response_405

    if response.status_code == 429:
        response_429 = Problem.from_dict(response.json())



        return response_429

    if response.status_code == 502:
        response_502 = Problem.from_dict(response.json())



        return response_502

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | Problem]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiRunsFormat | Unset = GetApiRunsFormat.JSON,
    comparable: GetApiRunsComparable | Unset = GetApiRunsComparable.ALL,

) -> Response[Any | Problem]:
    """ Machine-readable dump of the FULL run index (comparable + non-comparable)

     One-shot export of every community-measured run — including batched/non-comparable ones — so agents
    and crawlers can consume the whole dataset without JS or pagination round-trips. JSON envelope
    carries schemaVersion, generatedAt, rowCount, totalRunCount, comparableFilter and a structured
    dataDictionary; each run carries a `comparable` boolean so consumers can reproduce (or skip) the
    single-stream filter the aggregate endpoints use. CSV output is RFC 4180 with a `#`-comment preamble
    carrying metadata plus one dictionary line per column, served as a dated attachment. Shares the
    10-minute cached upstream fetch with the other benchmark endpoints.

    Args:
        format_ (GetApiRunsFormat | Unset):  Default: GetApiRunsFormat.JSON.
        comparable (GetApiRunsComparable | Unset):  Default: GetApiRunsComparable.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Problem]
     """


    kwargs = _get_kwargs(
        format_=format_,
comparable=comparable,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiRunsFormat | Unset = GetApiRunsFormat.JSON,
    comparable: GetApiRunsComparable | Unset = GetApiRunsComparable.ALL,

) -> Any | Problem | None:
    """ Machine-readable dump of the FULL run index (comparable + non-comparable)

     One-shot export of every community-measured run — including batched/non-comparable ones — so agents
    and crawlers can consume the whole dataset without JS or pagination round-trips. JSON envelope
    carries schemaVersion, generatedAt, rowCount, totalRunCount, comparableFilter and a structured
    dataDictionary; each run carries a `comparable` boolean so consumers can reproduce (or skip) the
    single-stream filter the aggregate endpoints use. CSV output is RFC 4180 with a `#`-comment preamble
    carrying metadata plus one dictionary line per column, served as a dated attachment. Shares the
    10-minute cached upstream fetch with the other benchmark endpoints.

    Args:
        format_ (GetApiRunsFormat | Unset):  Default: GetApiRunsFormat.JSON.
        comparable (GetApiRunsComparable | Unset):  Default: GetApiRunsComparable.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Problem
     """


    return sync_detailed(
        client=client,
format_=format_,
comparable=comparable,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiRunsFormat | Unset = GetApiRunsFormat.JSON,
    comparable: GetApiRunsComparable | Unset = GetApiRunsComparable.ALL,

) -> Response[Any | Problem]:
    """ Machine-readable dump of the FULL run index (comparable + non-comparable)

     One-shot export of every community-measured run — including batched/non-comparable ones — so agents
    and crawlers can consume the whole dataset without JS or pagination round-trips. JSON envelope
    carries schemaVersion, generatedAt, rowCount, totalRunCount, comparableFilter and a structured
    dataDictionary; each run carries a `comparable` boolean so consumers can reproduce (or skip) the
    single-stream filter the aggregate endpoints use. CSV output is RFC 4180 with a `#`-comment preamble
    carrying metadata plus one dictionary line per column, served as a dated attachment. Shares the
    10-minute cached upstream fetch with the other benchmark endpoints.

    Args:
        format_ (GetApiRunsFormat | Unset):  Default: GetApiRunsFormat.JSON.
        comparable (GetApiRunsComparable | Unset):  Default: GetApiRunsComparable.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Problem]
     """


    kwargs = _get_kwargs(
        format_=format_,
comparable=comparable,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    format_: GetApiRunsFormat | Unset = GetApiRunsFormat.JSON,
    comparable: GetApiRunsComparable | Unset = GetApiRunsComparable.ALL,

) -> Any | Problem | None:
    """ Machine-readable dump of the FULL run index (comparable + non-comparable)

     One-shot export of every community-measured run — including batched/non-comparable ones — so agents
    and crawlers can consume the whole dataset without JS or pagination round-trips. JSON envelope
    carries schemaVersion, generatedAt, rowCount, totalRunCount, comparableFilter and a structured
    dataDictionary; each run carries a `comparable` boolean so consumers can reproduce (or skip) the
    single-stream filter the aggregate endpoints use. CSV output is RFC 4180 with a `#`-comment preamble
    carrying metadata plus one dictionary line per column, served as a dated attachment. Shares the
    10-minute cached upstream fetch with the other benchmark endpoints.

    Args:
        format_ (GetApiRunsFormat | Unset):  Default: GetApiRunsFormat.JSON.
        comparable (GetApiRunsComparable | Unset):  Default: GetApiRunsComparable.ALL.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Problem
     """


    return (await asyncio_detailed(
        client=client,
format_=format_,
comparable=comparable,

    )).parsed
