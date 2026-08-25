from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.compute_result_warnings_item_code import ComputeResultWarningsItemCode
from ..types import UNSET, Unset

T = TypeVar("T", bound="ComputeResultWarningsItem")


@_attrs_define
class ComputeResultWarningsItem:
    """
    Attributes:
        code (ComputeResultWarningsItemCode | Unset):
        message (str | Unset):
    """

    code: ComputeResultWarningsItemCode | Unset = UNSET
    message: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code: str | Unset = UNSET
        if not isinstance(self.code, Unset):
            code = self.code.value

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if code is not UNSET:
            field_dict["code"] = code
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _code = d.pop("code", UNSET)
        code: ComputeResultWarningsItemCode | Unset
        if isinstance(_code, Unset):
            code = UNSET
        else:
            code = ComputeResultWarningsItemCode(_code)

        message = d.pop("message", UNSET)

        compute_result_warnings_item = cls(
            code=code,
            message=message,
        )

        compute_result_warnings_item.additional_properties = d
        return compute_result_warnings_item

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
