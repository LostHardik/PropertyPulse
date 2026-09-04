import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
function display(value){if(value===null||value===undefined)return '';if(value instanceof Date)return value.toISOString().slice(0,10);return String(value);}
export async function excel(rows,name,asOf){
 const workbook=new ExcelJS.Workbook();workbook.creator='PropertyPulse';
 const sheet=workbook.addWorksheet('Report');
 sheet.addRow([name,`As of ${asOf}`]);sheet.addRow(['Amounts ending in _paise are integer paise; 100 paise = INR 1.']);
 if(rows.length){const keys=Object.keys(rows[0]);sheet.addRow(keys);
 for(const row of rows)sheet.addRow(keys.map(k=>typeof row[k]==='number'?row[k]:display(row[k])));
 sheet.getRow(3).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(3).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF142B41'}};
 sheet.columns.forEach(c=>c.width=24);sheet.autoFilter={from:{row:3,column:1},to:{row:3,column:keys.length}};sheet.views=[{state:'frozen',ySplit:3}];
 }else sheet.addRow(['No matching records.']);
 // Strings are cell text, never ExcelJS formula objects.
 return workbook.xlsx.writeBuffer();
}
export function pdf(rows,name,asOf){return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:42});const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 doc.fontSize(22).text('PropertyPulse');doc.fontSize(14).text(name);doc.fontSize(10).text(`As of ${asOf} | ${rows.length} records`);doc.text('Amounts ending in _paise are integer paise (100 paise = INR 1).');doc.moveDown();
 // Vertical record cards avoid unreadable/wide report tables. Text wraps using
 // PDFKit's layout engine; record headings and labels remain searchable.
 rows.forEach((row,i)=>{if(doc.y>650)doc.addPage();doc.font('Helvetica-Bold').fontSize(11).text(`Record ${i+1}`);
 for(const [k,v] of Object.entries(row)){doc.font('Helvetica').fontSize(9).text(`${k}: ${display(v)}`);}doc.moveDown();});
 if(!rows.length)doc.text('No matching records.');doc.end();
});}
