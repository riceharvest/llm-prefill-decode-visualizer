from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="SnapshotRef")



@_attrs_define
class SnapshotRef:
    """ Content-addressed dataset snapshot actually served. Pin its id via ?snapshot= for reproducible numbers (see
    /api/snapshots).

        Attributes:
            id (str):  Example: snapshot-2026-08-21-a1b2c3d4.
            created_at (datetime.datetime | None | Unset):
            run_count (int | None | Unset):
     """

    id: str
    created_at: datetime.datetime | None | Unset = UNSET
    run_count: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        created_at: None | str | Unset
        if isinstance(self.created_at, Unset):
            created_at = UNSET
        elif isinstance(self.created_at, datetime.datetime):
            created_at = self.created_at.isoformat()
        else:
            created_at = self.created_at

        run_count: int | None | Unset
        if isinstance(self.run_count, Unset):
            run_count = UNSET
        else:
            run_count = self.run_count


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
        })
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if run_count is not UNSET:
            field_dict["runCount"] = run_count

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        def _parse_created_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                created_at_type_0 = datetime.datetime.fromisoformat(data)



                return created_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        created_at = _parse_created_at(d.pop("createdAt", UNSET))


        def _parse_run_count(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        run_count = _parse_run_count(d.pop("runCount", UNSET))


        snapshot_ref = cls(
            id=id,
            created_at=created_at,
            run_count=run_count,
        )


        snapshot_ref.additional_properties = d
        return snapshot_ref

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
