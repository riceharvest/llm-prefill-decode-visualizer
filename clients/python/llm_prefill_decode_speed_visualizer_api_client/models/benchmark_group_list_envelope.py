from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.benchmark_group_list_envelope_context_band_type_1 import BenchmarkGroupListEnvelopeContextBandType1
from ..models.benchmark_group_list_envelope_context_band_type_2_type_1 import BenchmarkGroupListEnvelopeContextBandType2Type1
from ..models.benchmark_group_list_envelope_context_band_type_3_type_1 import BenchmarkGroupListEnvelopeContextBandType3Type1
from ..types import UNSET, Unset
from typing import cast
from typing import Literal, cast
import datetime

if TYPE_CHECKING:
  from ..models.benchmark_group import BenchmarkGroup
  from ..models.benchmark_group_list_envelope_outlier_policy import BenchmarkGroupListEnvelopeOutlierPolicy
  from ..models.benchmark_group_list_envelope_unit_audit import BenchmarkGroupListEnvelopeUnitAudit
  from ..models.benchmark_group_list_envelope_units import BenchmarkGroupListEnvelopeUnits
  from ..models.caveat import Caveat
  from ..models.rate_limit import RateLimit
  from ..models.snapshot_ref import SnapshotRef





T = TypeVar("T", bound="BenchmarkGroupListEnvelope")



@_attrs_define
class BenchmarkGroupListEnvelope:
    """ Cursor-paginated aggregate groups, sorted by median decode desc (group-key tiebreak). Follow next_cursor until
    has_more is false.

        Attributes:
            total (int): Total matching groups across all pages
            items (list[BenchmarkGroup]):
            has_more (bool):
            description (str | Unset):
            note (str | Unset):
            snapshot (SnapshotRef | Unset): Content-addressed dataset snapshot actually served. Pin its id via ?snapshot=
                for reproducible numbers (see /api/snapshots).
            snapshot_at (datetime.datetime | None | Unset):
            matched_runs (int | Unset): Comparable runs that survived filtering before grouping
            limit (int | Unset): Effective page size after the 200 hard cap (#994)
            units (BenchmarkGroupListEnvelopeUnits | Unset): In-band unit declarations for every aggregate speed (all values
                tok/s) (#776)
            caveats (list[Caveat] | Unset): Dataset-level flags (n=1 share, mixed engine versions)
            warnings (list[str] | Unset): Human-readable group-level warnings (mixed context bands within a group key)
            max_age_days (float | None | Unset): Echoed ?max_age= filter (null when unset)
            context_band (BenchmarkGroupListEnvelopeContextBandType1 | BenchmarkGroupListEnvelopeContextBandType2Type1 |
                BenchmarkGroupListEnvelopeContextBandType3Type1 | None | Unset): Echoed ?context_band= filter (null when unset)
            distinct_model_families (int | Unset): Distinct model families across all matching runs
            distinct_engines (list[str] | Unset): Distinct "engine version" tags across matching runs
            engine_cohorted_by_default (bool | Unset): True when groups are keyed per engine build so mixed-engine stats
                never blend
            freshness_tiers (str | Unset): Human-readable definition of the fresh/aging/stale tiers
            outlier_policy (BenchmarkGroupListEnvelopeOutlierPolicy | Unset): How outlier runs are fenced and whether they
                are included in stats.
            unit_audit (BenchmarkGroupListEnvelopeUnitAudit | Unset): Unit-consistency audit across all matching runs.
            next_cursor (None | str | Unset):
            rate_limit (RateLimit | Unset): Machine-readable rate-limit state — the same numbers the X-RateLimit-* headers
                carry, for clients that only parse bodies.
            schema_version (Literal['1'] | Unset):
     """

    total: int
    items: list[BenchmarkGroup]
    has_more: bool
    description: str | Unset = UNSET
    note: str | Unset = UNSET
    snapshot: SnapshotRef | Unset = UNSET
    snapshot_at: datetime.datetime | None | Unset = UNSET
    matched_runs: int | Unset = UNSET
    limit: int | Unset = UNSET
    units: BenchmarkGroupListEnvelopeUnits | Unset = UNSET
    caveats: list[Caveat] | Unset = UNSET
    warnings: list[str] | Unset = UNSET
    max_age_days: float | None | Unset = UNSET
    context_band: BenchmarkGroupListEnvelopeContextBandType1 | BenchmarkGroupListEnvelopeContextBandType2Type1 | BenchmarkGroupListEnvelopeContextBandType3Type1 | None | Unset = UNSET
    distinct_model_families: int | Unset = UNSET
    distinct_engines: list[str] | Unset = UNSET
    engine_cohorted_by_default: bool | Unset = UNSET
    freshness_tiers: str | Unset = UNSET
    outlier_policy: BenchmarkGroupListEnvelopeOutlierPolicy | Unset = UNSET
    unit_audit: BenchmarkGroupListEnvelopeUnitAudit | Unset = UNSET
    next_cursor: None | str | Unset = UNSET
    rate_limit: RateLimit | Unset = UNSET
    schema_version: Literal['1'] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.benchmark_group import BenchmarkGroup
        from ..models.benchmark_group_list_envelope_outlier_policy import BenchmarkGroupListEnvelopeOutlierPolicy
        from ..models.benchmark_group_list_envelope_unit_audit import BenchmarkGroupListEnvelopeUnitAudit
        from ..models.benchmark_group_list_envelope_units import BenchmarkGroupListEnvelopeUnits
        from ..models.caveat import Caveat
        from ..models.rate_limit import RateLimit
        from ..models.snapshot_ref import SnapshotRef
        total = self.total

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)



        has_more = self.has_more

        description = self.description

        note = self.note

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

        matched_runs = self.matched_runs

        limit = self.limit

        units: dict[str, Any] | Unset = UNSET
        if not isinstance(self.units, Unset):
            units = self.units.to_dict()

        caveats: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.caveats, Unset):
            caveats = []
            for caveats_item_data in self.caveats:
                caveats_item = caveats_item_data.to_dict()
                caveats.append(caveats_item)



        warnings: list[str] | Unset = UNSET
        if not isinstance(self.warnings, Unset):
            warnings = self.warnings



        max_age_days: float | None | Unset
        if isinstance(self.max_age_days, Unset):
            max_age_days = UNSET
        else:
            max_age_days = self.max_age_days

        context_band: None | str | Unset
        if isinstance(self.context_band, Unset):
            context_band = UNSET
        elif isinstance(self.context_band, BenchmarkGroupListEnvelopeContextBandType1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, BenchmarkGroupListEnvelopeContextBandType2Type1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, BenchmarkGroupListEnvelopeContextBandType3Type1):
            context_band = self.context_band.value
        else:
            context_band = self.context_band

        distinct_model_families = self.distinct_model_families

        distinct_engines: list[str] | Unset = UNSET
        if not isinstance(self.distinct_engines, Unset):
            distinct_engines = self.distinct_engines



        engine_cohorted_by_default = self.engine_cohorted_by_default

        freshness_tiers = self.freshness_tiers

        outlier_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.outlier_policy, Unset):
            outlier_policy = self.outlier_policy.to_dict()

        unit_audit: dict[str, Any] | Unset = UNSET
        if not isinstance(self.unit_audit, Unset):
            unit_audit = self.unit_audit.to_dict()

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
        field_dict.update({
            "total": total,
            "items": items,
            "has_more": has_more,
        })
        if description is not UNSET:
            field_dict["description"] = description
        if note is not UNSET:
            field_dict["note"] = note
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if snapshot_at is not UNSET:
            field_dict["snapshotAt"] = snapshot_at
        if matched_runs is not UNSET:
            field_dict["matchedRuns"] = matched_runs
        if limit is not UNSET:
            field_dict["limit"] = limit
        if units is not UNSET:
            field_dict["units"] = units
        if caveats is not UNSET:
            field_dict["caveats"] = caveats
        if warnings is not UNSET:
            field_dict["warnings"] = warnings
        if max_age_days is not UNSET:
            field_dict["maxAgeDays"] = max_age_days
        if context_band is not UNSET:
            field_dict["contextBand"] = context_band
        if distinct_model_families is not UNSET:
            field_dict["distinctModelFamilies"] = distinct_model_families
        if distinct_engines is not UNSET:
            field_dict["distinctEngines"] = distinct_engines
        if engine_cohorted_by_default is not UNSET:
            field_dict["engineCohortedByDefault"] = engine_cohorted_by_default
        if freshness_tiers is not UNSET:
            field_dict["freshnessTiers"] = freshness_tiers
        if outlier_policy is not UNSET:
            field_dict["outlierPolicy"] = outlier_policy
        if unit_audit is not UNSET:
            field_dict["unitAudit"] = unit_audit
        if next_cursor is not UNSET:
            field_dict["next_cursor"] = next_cursor
        if rate_limit is not UNSET:
            field_dict["rate_limit"] = rate_limit
        if schema_version is not UNSET:
            field_dict["schema_version"] = schema_version

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.benchmark_group import BenchmarkGroup
        from ..models.benchmark_group_list_envelope_outlier_policy import BenchmarkGroupListEnvelopeOutlierPolicy
        from ..models.benchmark_group_list_envelope_unit_audit import BenchmarkGroupListEnvelopeUnitAudit
        from ..models.benchmark_group_list_envelope_units import BenchmarkGroupListEnvelopeUnits
        from ..models.caveat import Caveat
        from ..models.rate_limit import RateLimit
        from ..models.snapshot_ref import SnapshotRef
        d = dict(src_dict)
        total = d.pop("total")

        items = []
        _items = d.pop("items")
        for items_item_data in (_items):
            items_item = BenchmarkGroup.from_dict(items_item_data)



            items.append(items_item)


        has_more = d.pop("has_more")

        description = d.pop("description", UNSET)

        note = d.pop("note", UNSET)

        _snapshot = d.pop("snapshot", UNSET)
        snapshot: SnapshotRef | Unset
        if isinstance(_snapshot,  Unset):
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


        matched_runs = d.pop("matchedRuns", UNSET)

        limit = d.pop("limit", UNSET)

        _units = d.pop("units", UNSET)
        units: BenchmarkGroupListEnvelopeUnits | Unset
        if isinstance(_units,  Unset):
            units = UNSET
        else:
            units = BenchmarkGroupListEnvelopeUnits.from_dict(_units)




        _caveats = d.pop("caveats", UNSET)
        caveats: list[Caveat] | Unset = UNSET
        if _caveats is not UNSET:
            caveats = []
            for caveats_item_data in _caveats:
                caveats_item = Caveat.from_dict(caveats_item_data)



                caveats.append(caveats_item)


        warnings = cast(list[str], d.pop("warnings", UNSET))


        def _parse_max_age_days(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        max_age_days = _parse_max_age_days(d.pop("maxAgeDays", UNSET))


        def _parse_context_band(data: object) -> BenchmarkGroupListEnvelopeContextBandType1 | BenchmarkGroupListEnvelopeContextBandType2Type1 | BenchmarkGroupListEnvelopeContextBandType3Type1 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_1 = BenchmarkGroupListEnvelopeContextBandType1(data)



                return context_band_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_2_type_1 = BenchmarkGroupListEnvelopeContextBandType2Type1(data)



                return context_band_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_3_type_1 = BenchmarkGroupListEnvelopeContextBandType3Type1(data)



                return context_band_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BenchmarkGroupListEnvelopeContextBandType1 | BenchmarkGroupListEnvelopeContextBandType2Type1 | BenchmarkGroupListEnvelopeContextBandType3Type1 | None | Unset, data)

        context_band = _parse_context_band(d.pop("contextBand", UNSET))


        distinct_model_families = d.pop("distinctModelFamilies", UNSET)

        distinct_engines = cast(list[str], d.pop("distinctEngines", UNSET))


        engine_cohorted_by_default = d.pop("engineCohortedByDefault", UNSET)

        freshness_tiers = d.pop("freshnessTiers", UNSET)

        _outlier_policy = d.pop("outlierPolicy", UNSET)
        outlier_policy: BenchmarkGroupListEnvelopeOutlierPolicy | Unset
        if isinstance(_outlier_policy,  Unset):
            outlier_policy = UNSET
        else:
            outlier_policy = BenchmarkGroupListEnvelopeOutlierPolicy.from_dict(_outlier_policy)




        _unit_audit = d.pop("unitAudit", UNSET)
        unit_audit: BenchmarkGroupListEnvelopeUnitAudit | Unset
        if isinstance(_unit_audit,  Unset):
            unit_audit = UNSET
        else:
            unit_audit = BenchmarkGroupListEnvelopeUnitAudit.from_dict(_unit_audit)




        def _parse_next_cursor(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        next_cursor = _parse_next_cursor(d.pop("next_cursor", UNSET))


        _rate_limit = d.pop("rate_limit", UNSET)
        rate_limit: RateLimit | Unset
        if isinstance(_rate_limit,  Unset):
            rate_limit = UNSET
        else:
            rate_limit = RateLimit.from_dict(_rate_limit)




        schema_version = cast(Literal['1'] | Unset , d.pop("schema_version", UNSET))
        if schema_version != '1'and not isinstance(schema_version, Unset):
            raise ValueError(f"schema_version must match const '1', got '{schema_version}'")

        benchmark_group_list_envelope = cls(
            total=total,
            items=items,
            has_more=has_more,
            description=description,
            note=note,
            snapshot=snapshot,
            snapshot_at=snapshot_at,
            matched_runs=matched_runs,
            limit=limit,
            units=units,
            caveats=caveats,
            warnings=warnings,
            max_age_days=max_age_days,
            context_band=context_band,
            distinct_model_families=distinct_model_families,
            distinct_engines=distinct_engines,
            engine_cohorted_by_default=engine_cohorted_by_default,
            freshness_tiers=freshness_tiers,
            outlier_policy=outlier_policy,
            unit_audit=unit_audit,
            next_cursor=next_cursor,
            rate_limit=rate_limit,
            schema_version=schema_version,
        )


        benchmark_group_list_envelope.additional_properties = d
        return benchmark_group_list_envelope

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
