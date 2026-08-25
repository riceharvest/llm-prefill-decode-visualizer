from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="RateLimit")



@_attrs_define
class RateLimit:
    """ Machine-readable rate-limit state — the same numbers the X-RateLimit-* headers carry, for clients that only parse
    bodies.

        Attributes:
            limit (int): Requests allowed per window
            remaining (int): Requests remaining in the current window
            reset (int): Unix epoch seconds when the current window resets
            window_seconds (int): Window length in seconds
            policy (str): Limiting policy, e.g. fixed-window per client IP
     """

    limit: int
    remaining: int
    reset: int
    window_seconds: int
    policy: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        limit = self.limit

        remaining = self.remaining

        reset = self.reset

        window_seconds = self.window_seconds

        policy = self.policy


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "limit": limit,
            "remaining": remaining,
            "reset": reset,
            "window_seconds": window_seconds,
            "policy": policy,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        limit = d.pop("limit")

        remaining = d.pop("remaining")

        reset = d.pop("reset")

        window_seconds = d.pop("window_seconds")

        policy = d.pop("policy")

        rate_limit = cls(
            limit=limit,
            remaining=remaining,
            reset=reset,
            window_seconds=window_seconds,
            policy=policy,
        )


        rate_limit.additional_properties = d
        return rate_limit

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
