from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.caveat_severity import CaveatSeverity
from ..types import UNSET, Unset

T = TypeVar("T", bound="Caveat")


@_attrs_define
class Caveat:
    """Machine-readable dataset limitation. Branch on `code`; treat `severity` as display weight.

    Attributes:
        code (str):  Example: single_stream_only.
        severity (CaveatSeverity): Display weight. `warning` marks statistical limitations that should change how the
            number is used (n=1 groups, mixed engines/bands); `info` is contextual.
        summary (str):
        detail (str | Unset):
    """

    code: str
    severity: CaveatSeverity
    summary: str
    detail: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code

        severity = self.severity.value

        summary = self.summary

        detail = self.detail

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
                "severity": severity,
                "summary": summary,
            }
        )
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code = d.pop("code")

        severity = CaveatSeverity(d.pop("severity"))

        summary = d.pop("summary")

        detail = d.pop("detail", UNSET)

        caveat = cls(
            code=code,
            severity=severity,
            summary=summary,
            detail=detail,
        )

        caveat.additional_properties = d
        return caveat

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
