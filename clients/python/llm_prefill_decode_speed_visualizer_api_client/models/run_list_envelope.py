from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.run_list_envelope_context_band_type_1 import RunListEnvelopeContextBandType1
from ..models.run_list_envelope_context_band_type_2_type_1 import RunListEnvelopeContextBandType2Type1
from ..models.run_list_envelope_context_band_type_3_type_1 import RunListEnvelopeContextBandType3Type1
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.caveat import Caveat
    from ..models.rate_limit import RateLimit
    from ..models.run import Run
    from ..models.snapshot_ref import SnapshotRef


T = TypeVar("T", bound="RunListEnvelope")


@_attrs_define
class RunListEnvelope:
    """Cursor-paginated raw run list, sorted by decode speed desc (runId tiebreak). Follow next_cursor until has_more is
    false.

        Attributes:
            total (int): Total matching runs across all pages
            items (list[Run]):
            has_more (bool):
            description (str | Unset):
            snapshot (SnapshotRef | Unset): Content-addressed dataset snapshot actually served. Pin its id via ?snapshot=
                for reproducible numbers (see /api/snapshots).
            snapshot_at (datetime.datetime | None | Unset):
            max_age_days (float | None | Unset): Echoed ?max_age= filter (null when unset)
            context_band (None | RunListEnvelopeContextBandType1 | RunListEnvelopeContextBandType2Type1 |
                RunListEnvelopeContextBandType3Type1 | Unset): Echoed ?context_band= filter (null when unset)
            caveats (list[Caveat] | Unset):
            next_cursor (None | str | Unset): Opaque keyset cursor; pass back as ?cursor=
            rate_limit (RateLimit | Unset): Machine-readable rate-limit state — the same numbers the X-RateLimit-* headers
                carry, for clients that only parse bodies.
            schema_version (Literal['1'] | Unset):
    """

    total: int
    items: list[Run]
    has_more: bool
    description: str | Unset = UNSET
    snapshot: SnapshotRef | Unset = UNSET
    snapshot_at: datetime.datetime | None | Unset = UNSET
    max_age_days: float | None | Unset = UNSET
    context_band: (
        None
        | RunListEnvelopeContextBandType1
        | RunListEnvelopeContextBandType2Type1
        | RunListEnvelopeContextBandType3Type1
        | Unset
    ) = UNSET
    caveats: list[Caveat] | Unset = UNSET
    next_cursor: None | str | Unset = UNSET
    rate_limit: RateLimit | Unset = UNSET
    schema_version: Literal["1"] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        total = self.total

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        has_more = self.has_more

        description = self.description

        snapshot: dict[str, Any] | Unset = UNSET
        if not isinstance(self.snapshot, Unset):
            snapshot = self.snapshot.to_dict()

        snapshot_at: None | str | Unset
        if isinstance(self.snapshot_at, Unset):
            snapshot_at = UNSET
        elif isinstance(self.snapshot_at, datetime.datetime):
            snapshot_at = self.snapshot_at.isoformat()
        else:
            snapshot_at = self.snapshot_at

        max_age_days: float | None | Unset
        if isinstance(self.max_age_days, Unset):
            max_age_days = UNSET
        else:
            max_age_days = self.max_age_days

        context_band: None | str | Unset
        if isinstance(self.context_band, Unset):
            context_band = UNSET
        elif isinstance(self.context_band, RunListEnvelopeContextBandType1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, RunListEnvelopeContextBandType2Type1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, RunListEnvelopeContextBandType3Type1):
            context_band = self.context_band.value
        else:
            context_band = self.context_band

        caveats: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.caveats, Unset):
            caveats = []
            for caveats_item_data in self.caveats:
                caveats_item = caveats_item_data.to_dict()
                caveats.append(caveats_item)

        next_cursor: None | str | Unset
        if isinstance(self.next_cursor, Unset):
            next_cursor = UNSET
        else:
            next_cursor = self.next_cursor

        rate_limit: dict[str, Any] | Unset = UNSET
        if not isinstance(self.rate_limit, Unset):
            rate_limit = self.rate_limit.to_dict()

        schema_version = self.schema_version

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "total": total,
                "items": items,
                "has_more": has_more,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if snapshot_at is not UNSET:
            field_dict["snapshotAt"] = snapshot_at
        if max_age_days is not UNSET:
            field_dict["maxAgeDays"] = max_age_days
        if context_band is not UNSET:
            field_dict["contextBand"] = context_band
        if caveats is not UNSET:
            field_dict["caveats"] = caveats
        if next_cursor is not UNSET:
            field_dict["next_cursor"] = next_cursor
        if rate_limit is not UNSET:
            field_dict["rate_limit"] = rate_limit
        if schema_version is not UNSET:
            field_dict["schema_version"] = schema_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.caveat import Caveat
        from ..models.rate_limit import RateLimit
        from ..models.run import Run
        from ..models.snapshot_ref import SnapshotRef

        d = dict(src_dict)
        total = d.pop("total")

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = Run.from_dict(items_item_data)

            items.append(items_item)

        has_more = d.pop("has_more")

        description = d.pop("description", UNSET)

        _snapshot = d.pop("snapshot", UNSET)
        snapshot: SnapshotRef | Unset
        if isinstance(_snapshot, Unset):
            snapshot = UNSET
        else:
            snapshot = SnapshotRef.from_dict(_snapshot)

        def _parse_snapshot_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                snapshot_at_type_0 = datetime.datetime.fromisoformat(data)

                return snapshot_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        snapshot_at = _parse_snapshot_at(d.pop("snapshotAt", UNSET))

        def _parse_max_age_days(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        max_age_days = _parse_max_age_days(d.pop("maxAgeDays", UNSET))

        def _parse_context_band(
            data: object,
        ) -> (
            None
            | RunListEnvelopeContextBandType1
            | RunListEnvelopeContextBandType2Type1
            | RunListEnvelopeContextBandType3Type1
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_1 = RunListEnvelopeContextBandType1(data)

                return context_band_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_2_type_1 = RunListEnvelopeContextBandType2Type1(data)

                return context_band_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_3_type_1 = RunListEnvelopeContextBandType3Type1(data)

                return context_band_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | RunListEnvelopeContextBandType1
                | RunListEnvelopeContextBandType2Type1
                | RunListEnvelopeContextBandType3Type1
                | Unset,
                data,
            )

        context_band = _parse_context_band(d.pop("contextBand", UNSET))

        _caveats = d.pop("caveats", UNSET)
        caveats: list[Caveat] | Unset = UNSET
        if _caveats is not UNSET:
            caveats = []
            for caveats_item_data in _caveats:
                caveats_item = Caveat.from_dict(caveats_item_data)

                caveats.append(caveats_item)

        def _parse_next_cursor(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        next_cursor = _parse_next_cursor(d.pop("next_cursor", UNSET))

        _rate_limit = d.pop("rate_limit", UNSET)
        rate_limit: RateLimit | Unset
        if isinstance(_rate_limit, Unset):
            rate_limit = UNSET
        else:
            rate_limit = RateLimit.from_dict(_rate_limit)

        schema_version = cast(Literal["1"] | Unset, d.pop("schema_version", UNSET))
        if schema_version != "1" and not isinstance(schema_version, Unset):
            raise ValueError(f"schema_version must match const '1', got '{schema_version}'")

        run_list_envelope = cls(
            total=total,
            items=items,
            has_more=has_more,
            description=description,
            snapshot=snapshot,
            snapshot_at=snapshot_at,
            max_age_days=max_age_days,
            context_band=context_band,
            caveats=caveats,
            next_cursor=next_cursor,
            rate_limit=rate_limit,
            schema_version=schema_version,
        )

        run_list_envelope.additional_properties = d
        return run_list_envelope

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
