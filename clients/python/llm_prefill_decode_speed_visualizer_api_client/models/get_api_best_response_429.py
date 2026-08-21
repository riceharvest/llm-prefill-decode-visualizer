from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="GetApiBestResponse429")



@_attrs_define
class GetApiBestResponse429:
    """ 
        Attributes:
            error (str | Unset):
            limit (int | Unset):
            remaining (int | Unset):
            reset (int | Unset): Unix epoch seconds
            retry_after_seconds (int | Unset):
     """

    error: str | Unset = UNSET
    limit: int | Unset = UNSET
    remaining: int | Unset = UNSET
    reset: int | Unset = UNSET
    retry_after_seconds: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        error = self.error

        limit = self.limit

        remaining = self.remaining

        reset = self.reset

        retry_after_seconds = self.retry_after_seconds


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if error is not UNSET:
            field_dict["error"] = error
        if limit is not UNSET:
            field_dict["limit"] = limit
        if remaining is not UNSET:
            field_dict["remaining"] = remaining
        if reset is not UNSET:
            field_dict["reset"] = reset
        if retry_after_seconds is not UNSET:
            field_dict["retryAfterSeconds"] = retry_after_seconds

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error", UNSET)

        limit = d.pop("limit", UNSET)

        remaining = d.pop("remaining", UNSET)

        reset = d.pop("reset", UNSET)

        retry_after_seconds = d.pop("retryAfterSeconds", UNSET)

        get_api_best_response_429 = cls(
            error=error,
            limit=limit,
            remaining=remaining,
            reset=reset,
            retry_after_seconds=retry_after_seconds,
        )


        get_api_best_response_429.additional_properties = d
        return get_api_best_response_429

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
