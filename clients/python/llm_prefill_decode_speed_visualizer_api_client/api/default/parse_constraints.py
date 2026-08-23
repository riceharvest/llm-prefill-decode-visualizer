from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.parse_constraints_response_200 import ParseConstraintsResponse200
from ...models.problem import Problem
from typing import cast



def _get_kwargs(
    *,
    q: str,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["q"] = q


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/parse-constraints",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ParseConstraintsResponse200 | Problem | None:
    if response.status_code == 200:
        response_200 = ParseConstraintsResponse200.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = Problem.from_dict(response.json())



        return response_400

    if response.status_code == 429:
        response_429 = Problem.from_dict(response.json())



        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ParseConstraintsResponse200 | Problem]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    q: str,

) -> Response[ParseConstraintsResponse200 | Problem]:
    r""" Parse plain-language constraints into the canonical constraint JSON

     Converts a natural-language constraint string (e.g. \"self-hosted Qwen 27B at Q4 for 10 users under
    $1500\") into the canonical constraint struct used by /api/sizing and /api/best. Deterministic
    regex/heuristics — no external LLM calls. Returns the echoed input, the parsed struct (null = not
    stated) and an `ambiguities` array listing every assumption (e.g. \"10 users: assume 1 stream each
    or batched?\"), plus a ready-made `sizingQuery` for the downstream decision endpoint.

    Args:
        q (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ParseConstraintsResponse200 | Problem]
     """


    kwargs = _get_kwargs(
        q=q,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    q: str,

) -> ParseConstraintsResponse200 | Problem | None:
    r""" Parse plain-language constraints into the canonical constraint JSON

     Converts a natural-language constraint string (e.g. \"self-hosted Qwen 27B at Q4 for 10 users under
    $1500\") into the canonical constraint struct used by /api/sizing and /api/best. Deterministic
    regex/heuristics — no external LLM calls. Returns the echoed input, the parsed struct (null = not
    stated) and an `ambiguities` array listing every assumption (e.g. \"10 users: assume 1 stream each
    or batched?\"), plus a ready-made `sizingQuery` for the downstream decision endpoint.

    Args:
        q (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ParseConstraintsResponse200 | Problem
     """


    return sync_detailed(
        client=client,
q=q,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    q: str,

) -> Response[ParseConstraintsResponse200 | Problem]:
    r""" Parse plain-language constraints into the canonical constraint JSON

     Converts a natural-language constraint string (e.g. \"self-hosted Qwen 27B at Q4 for 10 users under
    $1500\") into the canonical constraint struct used by /api/sizing and /api/best. Deterministic
    regex/heuristics — no external LLM calls. Returns the echoed input, the parsed struct (null = not
    stated) and an `ambiguities` array listing every assumption (e.g. \"10 users: assume 1 stream each
    or batched?\"), plus a ready-made `sizingQuery` for the downstream decision endpoint.

    Args:
        q (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ParseConstraintsResponse200 | Problem]
     """


    kwargs = _get_kwargs(
        q=q,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    q: str,

) -> ParseConstraintsResponse200 | Problem | None:
    r""" Parse plain-language constraints into the canonical constraint JSON

     Converts a natural-language constraint string (e.g. \"self-hosted Qwen 27B at Q4 for 10 users under
    $1500\") into the canonical constraint struct used by /api/sizing and /api/best. Deterministic
    regex/heuristics — no external LLM calls. Returns the echoed input, the parsed struct (null = not
    stated) and an `ambiguities` array listing every assumption (e.g. \"10 users: assume 1 stream each
    or batched?\"), plus a ready-made `sizingQuery` for the downstream decision endpoint.

    Args:
        q (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ParseConstraintsResponse200 | Problem
     """


    return (await asyncio_detailed(
        client=client,
q=q,

    )).parsed
