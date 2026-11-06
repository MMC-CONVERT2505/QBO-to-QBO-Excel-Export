import { REGIONS } from "../config/regions.js";
import { ENTITIES } from "../config/entities.js";
import { listAvailableTemplates } from "../services/template.service.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// GET /api/regions
// Every destination region the frontend can offer, plus which modules
// actually have a template ready (so the UI can grey out modules a
// region doesn't support yet instead of failing at export time).
export const getRegions = (req, res) => {

    const regions = Object.values(REGIONS)
        .filter((region) => !region.hidden)
        .map(({ hidden, ...region }) => ({
            ...region,
            availableModules: listAvailableTemplates(region.code)
        }));

    res.status(200).json({ success: true, regions });

};

// GET /api/templates/:region
export const getRegionTemplates = asyncHandler(async (req, res) => {

    const { region } = req.params;
    const availableModules = listAvailableTemplates(region);

    if (!(region.toUpperCase() in REGIONS)) {
        throw new AppError(`Unsupported region: ${region}`, 400);
    }

    res.status(200).json({
        success: true,
        region: region.toUpperCase(),
        modules: availableModules.map((key) => ({
            key,
            label: ENTITIES[key]?.label || key
        }))
    });

});
