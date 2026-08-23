from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.problem_code import ProblemCode
from ..types import UNSET, Unset

T = TypeVar("T", bound="Problem")


@_attrs_define
class Problem:
    """RFC 9457 problem+json error body. Content-Type: application/problem+json.

    Attributes:
        type_ (str): Stable problem-type URI, e.g. .../problems/invalid-params
        title (str): Short human-readable summary
        status (int): HTTP status code
        code (ProblemCode): Stable machine-readable error code — branch on this, not on title/detail prose
        detail (str | Unset): Human-readable explanation of this occurrence
        instance (str | Unset): Request path + query that produced the error
    """

    type_: str
    title: str
    status: int
    code: ProblemCode
    detail: str | Unset = UNSET
    instance: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        title = self.title

        status = self.status

        code = self.code.value

        detail = self.detail

        instance = self.instance

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "title": title,
                "status": status,
                "code": code,
            }
        )
        if detail is not UNSET:
            field_dict["detail"] = detail
        if instance is not UNSET:
            field_dict["instance"] = instance

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        title = d.pop("title")

        status = d.pop("status")

        code = ProblemCode(d.pop("code"))

        detail = d.pop("detail", UNSET)

        instance = d.pop("instance", UNSET)

        problem = cls(
            type_=type_,
            title=title,
            status=status,
            code=code,
            detail=detail,
            instance=instance,
        )

        problem.additional_properties = d
        return problem

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
