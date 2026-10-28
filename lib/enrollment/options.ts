// Pick lists shared by the staff "New application" panel and the public form.

export const COURSES = ["BSIT", "BSCS", "BSBA", "BSEd", "BSN"];
export const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
export const GRADES = ["Kindergarten", ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];
export const STRANDS = ["STEM", "ABM", "HUMSS", "GAS", "TVL"];
