<?php

namespace App\Services;

/**
 * The CBIC's Unit Quantity Codes, as a GST return accepts them.
 *
 * Published reference data, not a judgement: the list is fixed by the GSTN
 * schema and is the same for every taxpayer, so it lives in code rather than in
 * a per-company table that each tenant would have to seed and could drift.
 *
 * Two screens read it. The unit form offers it as a searchable field instead of
 * a free-text box a reader has to guess at, and the units list derives each
 * unit's TYPE from it: a unit whose `uqc_gst` is one of these codes is
 * reportable on a return as it stands (STANDARD); one with no code, or a code
 * the schema does not know, is not (CUSTOM) and has to be mapped before filing.
 *
 * That is the whole claim. It says nothing about who created the unit — the
 * table has no provenance column, and inferring one from a name would be a
 * guess printed as a fact.
 */
final class GstUqcCatalog
{
    /** code => the description the GSTN schema gives it. */
    public const CODES = [
        'BAG' => 'Bags',
        'BAL' => 'Bale',
        'BDL' => 'Bundles',
        'BKL' => 'Buckles',
        'BOU' => 'Billion of units',
        'BOX' => 'Box',
        'BTL' => 'Bottles',
        'BUN' => 'Bunches',
        'CAN' => 'Cans',
        'CBM' => 'Cubic metres',
        'CCM' => 'Cubic centimetres',
        'CMS' => 'Centimetres',
        'CTN' => 'Cartons',
        'DOZ' => 'Dozens',
        'DRM' => 'Drums',
        'GGK' => 'Great gross',
        'GMS' => 'Grammes',
        'GRS' => 'Gross',
        'GYD' => 'Gross yards',
        'KGS' => 'Kilograms',
        'KLR' => 'Kilolitre',
        'KME' => 'Kilometre',
        'MLT' => 'Millilitre',
        'MTR' => 'Metres',
        'MTS' => 'Metric ton',
        'NOS' => 'Numbers',
        'PAC' => 'Packs',
        'PCS' => 'Pieces',
        'PRS' => 'Pairs',
        'QTL' => 'Quintal',
        'ROL' => 'Rolls',
        'SET' => 'Sets',
        'SQF' => 'Square feet',
        'SQM' => 'Square metres',
        'SQY' => 'Square yards',
        'TBS' => 'Tablets',
        'TGM' => 'Ten gross',
        'THD' => 'Thousands',
        'TON' => 'Tonnes',
        'TUB' => 'Tubes',
        'UGS' => 'US gallons',
        'UNT' => 'Units',
        'YDS' => 'Yards',
        'OTH' => 'Others',
    ];

    /** @return list<string> */
    public static function codes(): array
    {
        return array_keys(self::CODES);
    }

    /** @return list<array{code:string, label:string}> */
    public static function options(): array
    {
        $out = [];
        foreach (self::CODES as $code => $label) {
            $out[] = ['code' => $code, 'label' => $label];
        }

        return $out;
    }

    /** The stored value as the schema spells it, or null when it is not a code at all. */
    public static function normalise(?string $code): ?string
    {
        $key = strtoupper(trim((string) $code));

        return $key !== '' && isset(self::CODES[$key]) ? $key : null;
    }

    public static function isValid(?string $code): bool
    {
        return self::normalise($code) !== null;
    }
}
