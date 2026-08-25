from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.create_watch_body import CreateWatchBody
from ...models.create_watch_response_429 import CreateWatchResponse429
from typing import cast



def _get_kwargs(
    *,
    body: CreateWatchBody,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/watch",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | CreateWatchResponse429 | None:
    if response.status_code == 201:
        response_201 = cast(Any, None)
        return response_201

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if response.status_code == 429:
        response_429 = CreateWatchResponse429.from_dict(response.json())



        return response_429

    if response.status_code == 503:
        response_503 = cast(Any, None)
        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | CreateWatchResponse429]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: CreateWatchBody,

) -> Response[Any | CreateWatchResponse429]:
    """ Create a watch for a hardware+model combo (#109)

     Body: { model?, hardware?, quant?, webhookUrl?, includeExisting? } — at least one of model/hardware
    required; webhookUrl must be https. includeExisting=true opts into receiving matching runs dated
    before the watch was created (backfilled/imported data) on the first dispatch (#699). Returns 201
    with watchId + secret (shown exactly once; required to DELETE, sent to your webhook as X-Watch-
    Secret) and a ready-made rssUrl. RSS polling needs no webhook: GET
    /api/watch/rss.xml?model=&hardware=&quant=&page=&perPage=.

    Args:
        body (CreateWatchBody): Watched combo. At least one of 'model' / 'hardware' is required;
            'quant' optional; 'webhookUrl' must be https when present.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateWatchResponse429]
     """


    kwargs = _get_kwargs(
        body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    body: CreateWatchBody,

) -> Any | CreateWatchResponse429 | None:
    """ Create a watch for a hardware+model combo (#109)

     Body: { model?, hardware?, quant?, webhookUrl?, includeExisting? } — at least one of model/hardware
    required; webhookUrl must be https. includeExisting=true opts into receiving matching runs dated
    before the watch was created (backfilled/imported data) on the first dispatch (#699). Returns 201
    with watchId + secret (shown exactly once; required to DELETE, sent to your webhook as X-Watch-
    Secret) and a ready-made rssUrl. RSS polling needs no webhook: GET
    /api/watch/rss.xml?model=&hardware=&quant=&page=&perPage=.

    Args:
        body (CreateWatchBody): Watched combo. At least one of 'model' / 'hardware' is required;
            'quant' optional; 'webhookUrl' must be https when present.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateWatchResponse429
     """


    return sync_detailed(
        client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: CreateWatchBody,

) -> Response[Any | CreateWatchResponse429]:
    """ Create a watch for a hardware+model combo (#109)

     Body: { model?, hardware?, quant?, webhookUrl?, includeExisting? } — at least one of model/hardware
    required; webhookUrl must be https. includeExisting=true opts into receiving matching runs dated
    before the watch was created (backfilled/imported data) on the first dispatch (#699). Returns 201
    with watchId + secret (shown exactly once; required to DELETE, sent to your webhook as X-Watch-
    Secret) and a ready-made rssUrl. RSS polling needs no webhook: GET
    /api/watch/rss.xml?model=&hardware=&quant=&page=&perPage=.

    Args:
        body (CreateWatchBody): Watched combo. At least one of 'model' / 'hardware' is required;
            'quant' optional; 'webhookUrl' must be https when present.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | CreateWatchResponse429]
     """


    kwargs = _get_kwargs(
        body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: CreateWatchBody,

) -> Any | CreateWatchResponse429 | None:
    """ Create a watch for a hardware+model combo (#109)

     Body: { model?, hardware?, quant?, webhookUrl?, includeExisting? } — at least one of model/hardware
    required; webhookUrl must be https. includeExisting=true opts into receiving matching runs dated
    before the watch was created (backfilled/imported data) on the first dispatch (#699). Returns 201
    with watchId + secret (shown exactly once; required to DELETE, sent to your webhook as X-Watch-
    Secret) and a ready-made rssUrl. RSS polling needs no webhook: GET
    /api/watch/rss.xml?model=&hardware=&quant=&page=&perPage=.

    Args:
        body (CreateWatchBody): Watched combo. At least one of 'model' / 'hardware' is required;
            'quant' optional; 'webhookUrl' must be https when present.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | CreateWatchResponse429
     """


    return (await asyncio_detailed(
        client=client,
body=body,

    )).parsed
