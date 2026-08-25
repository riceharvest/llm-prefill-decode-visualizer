from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.replay_calculation_endpoint import ReplayCalculationEndpoint
from ...types import UNSET, Unset



def _get_kwargs(
    id: str,
    *,
    endpoint: ReplayCalculationEndpoint | Unset = ReplayCalculationEndpoint.COMPUTE,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    json_endpoint: str | Unset = UNSET
    if not isinstance(endpoint, Unset):
        json_endpoint = endpoint.value

    params["endpoint"] = json_endpoint


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/calc/{id}".format(id=quote(str(id), safe=""),),
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | None:
    if response.status_code == 200:
        return None

    if response.status_code == 400:
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
    id: str,
    *,
    client: AuthenticatedClient | Client,
    endpoint: ReplayCalculationEndpoint | Unset = ReplayCalculationEndpoint.COMPUTE,

) -> Response[Any]:
    """ Replay a computation or recommendation from its deterministic id

     Ids are content hashes (calc_ + 12 hex chars of sha256 over the normalized request) returned as `id`
    by /api/compute and /api/best. They are not stored anywhere: re-send the original parameters
    alongside the id and this endpoint re-runs the same math and returns the result with verified:true.
    A mismatching parameter set is rejected with the expected id.

    Args:
        id (str):
        endpoint (ReplayCalculationEndpoint | Unset):  Default: ReplayCalculationEndpoint.COMPUTE.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
     """


    kwargs = _get_kwargs(
        id=id,
endpoint=endpoint,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient | Client,
    endpoint: ReplayCalculationEndpoint | Unset = ReplayCalculationEndpoint.COMPUTE,

) -> Response[Any]:
    """ Replay a computation or recommendation from its deterministic id

     Ids are content hashes (calc_ + 12 hex chars of sha256 over the normalized request) returned as `id`
    by /api/compute and /api/best. They are not stored anywhere: re-send the original parameters
    alongside the id and this endpoint re-runs the same math and returns the result with verified:true.
    A mismatching parameter set is rejected with the expected id.

    Args:
        id (str):
        endpoint (ReplayCalculationEndpoint | Unset):  Default: ReplayCalculationEndpoint.COMPUTE.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any]
     """


    kwargs = _get_kwargs(
        id=id,
endpoint=endpoint,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

