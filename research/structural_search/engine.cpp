// Exact kernels; generated programs select data flow and lazy index construction.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <numeric>
#include <sstream>
#include <string>
#include <time.h>
#include <unordered_map>
#include <vector>
using namespace std;
using Bits=vector<uint64_t>; using Answer=pair<int,int>;
uint64_t clock_ns(){timespec t;clock_gettime(CLOCK_PROCESS_CPUTIME_ID,&t);return t.tv_sec*1000000000ull+t.tv_nsec;}
string decode(string h){string r;for(size_t i=0;i<h.size();i+=2)r+=char(stoul(h.substr(i,2),nullptr,16));return r;}
struct Case{string id;vector<string> bank,targets;vector<int> exists;};
struct Context{
 const Case& c;int n,b,w;bool have_meta=false,have_bits=false,have_hash=false;
 vector<vector<vector<int>>> fibers;vector<string> inverses;vector<int> ranks,order;
 vector<Bits> bits;unordered_map<string,int> exact;
 Context(const Case& v):c(v),n(v.bank[0].size()),b(v.bank.size()),w((b+63)/64){}
 void meta(){if(have_meta)return;have_meta=true;
  for(auto& t:c.bank){vector<vector<int>> f(n);for(int x=0;x<n;x++)f[(unsigned char)t[x]].push_back(x);
   int rank=0;for(auto& a:f)rank+=!a.empty();string inv;
   if(rank==n)for(auto& a:f)inv+=char(a[0]);
   ranks.push_back(rank);inverses.push_back(inv);fibers.push_back(move(f));}}
 void hash(){if(have_hash)return;have_hash=true;for(int i=0;i<b;i++)exact[c.bank[i]]=i;}
 void index(){if(have_bits)return;have_bits=true;bits.assign(n*n,Bits(w));vector<vector<int>> counts(n,vector<int>(n));
  for(int i=0;i<b;i++)for(int x=0;x<n;x++){int v=(unsigned char)c.bank[i][x];bits[x*n+v][i/64]|=1ull<<(i%64);counts[x][v]++;}
  vector<double> entropy(n);for(int x=0;x<n;x++)for(int count:counts[x])if(count){double p=double(count)/b;entropy[x]-=p*log2(p);}
  order.resize(n);iota(order.begin(),order.end(),0);stable_sort(order.begin(),order.end(),[&](int x,int y){return entropy[x]>entropy[y];});}
 int feature(int f){if(f==2)return c.targets.size();if(f==3)return n;if(f==4)return b;
  if(f==5){int sum=0;for(auto& t:c.targets){vector<bool> seen(n);for(unsigned char y:t)seen[y]=true;sum+=count(seen.begin(),seen.end(),true);}return c.targets.empty()?0:100*sum/(n*c.targets.size());}
  meta();if(f==0)return 100*count(ranks.begin(),ranks.end(),n)/b;
  return 100*accumulate(ranks.begin(),ranks.end(),0)/(n*b);}
 bool match(int i,int j,const string& t)const{for(int x=0;x<n;x++)if(c.bank[j][(unsigned char)c.bank[i][x]]!=t[x])return false;return true;}
 Bits all(){Bits a(w,~0ull);if(b%64)a.back()=(1ull<<(b%64))-1;return a;}
 int count_bits(const Bits& a){int count=0;for(auto k:a){count+=__builtin_popcountll(k);if(count>4)break;}return count;}
 bool intersect(Bits& a,const Bits& m){bool any=false;for(int k=0;k<w;k++){a[k]&=m[k];any|=bool(a[k]);}return any;}
 Answer finish(const Bits& a,int outer,const string& t,bool forward){for(int k=0;k<w;k++){auto block=a[k];while(block){int inner=k*64+__builtin_ctzll(block);int i=forward?outer:inner,j=forward?inner:outer;if(match(i,j,t))return {i,j};block&=block-1;}}return {-1,-1};}
 Answer solve(const string& t,int kernel){
  if(kernel<2){if(kernel==1){meta();hash();}for(int j=0;j<b;j++){
    if(kernel==1&&!inverses[j].empty()){string r(n,'\0');for(int x=0;x<n;x++)r[x]=inverses[j][(unsigned char)t[x]];auto it=exact.find(r);if(it!=exact.end())return {it->second,j};continue;}
    for(int i=0;i<b;i++)if(match(i,j,t))return {i,j};}return {-1,-1};}
  if(kernel==2){meta();hash();index();for(int j=0;j<b;j++){
    if(!inverses[j].empty()){string r(n,'\0');for(int x=0;x<n;x++)r[x]=inverses[j][(unsigned char)t[x]];auto it=exact.find(r);if(it!=exact.end())return {it->second,j};continue;}
    Bits a=all();for(int x:order){if(count_bits(a)<=4)break;Bits m(w);for(int v:fibers[j][(unsigned char)t[x]])for(int k=0;k<w;k++)m[k]|=bits[x*n+v][k];if(!intersect(a,m))break;}
    auto r=finish(a,j,t,false);if(r.first>=0)return r;}return {-1,-1};}
  // Forward join constrains suffix[prefix[x]] directly; no inverse-fiber unions.
  if(kernel==5){meta();hash();}index();
  for(int i=0;i<b;i++){
   if(kernel==5&&!inverses[i].empty()){string r(n,'\0');for(int y=0;y<n;y++)r[y]=t[(unsigned char)inverses[i][y]];auto it=exact.find(r);if(it!=exact.end())return {i,it->second};continue;}
   Bits a=all();bool conflict=false;vector<pair<int,int>> requirements;
   if(kernel>=4){vector<int> req(n,-1);for(int x=0;x<n;x++){int v=(unsigned char)c.bank[i][x],y=(unsigned char)t[x];if(req[v]>=0&&req[v]!=y){conflict=true;break;}req[v]=y;}
    if(conflict)continue;for(int v:order)if(req[v]>=0)requirements.push_back({v,req[v]});}
   else for(int x=0;x<n;x++)requirements.push_back({(unsigned char)c.bank[i][x],(unsigned char)t[x]});
   for(auto [v,y]:requirements){if(count_bits(a)<=4)break;if(!intersect(a,bits[v*n+y]))break;}
   auto r=finish(a,i,t,true);if(r.first>=0)return r;
  }return {-1,-1};
 }
};
struct Plan{int kernel=-1,feature=0,threshold=0,left=-1,right=-1;};
int parse(istringstream& s,vector<Plan>& nodes,int depth=0){string op;if(!(s>>op)||depth>3||nodes.size()>30)throw runtime_error("Invalid plan");int id=nodes.size();nodes.push_back({});
 if(op=="k"){int k;s>>k;if(!s||k<0||k>5)throw runtime_error("Invalid kernel");nodes[id].kernel=k;}
 else if(op=="b"){int f,t;s>>f>>t;if(!s||f<0||f>5||t<0||t>20000)throw runtime_error("Invalid branch");nodes[id].feature=f;nodes[id].threshold=t;int l=parse(s,nodes,depth+1),r=parse(s,nodes,depth+1);nodes[id].left=l;nodes[id].right=r;}
 else throw runtime_error("Invalid opcode");return id;}
int choose(Context& c,const vector<Plan>& p,int id=0){auto a=p[id];return a.kernel>=0?a.kernel:choose(c,p,c.feature(a.feature)<=a.threshold?a.left:a.right);}
int main(int argc,char** argv){try{
 if(argc<3)return 2;ifstream in(argv[1]);int count;in>>count;vector<Case> cases;
 for(int q=0;q<count;q++){Case c;int b,k;in>>c.id>>b>>k;string h;for(int i=0;i<b;i++){in>>h;c.bank.push_back(decode(h));}for(int i=0;i<k;i++){int e;in>>h>>e;c.targets.push_back(decode(h));c.exists.push_back(e);}cases.push_back(move(c));}
 int repeats=stoi(argv[2]);string line;while(getline(cin,line)){if(line.empty())continue;istringstream source(line);vector<Plan> plan;parse(source,plan);string extra;if(source>>extra)throw runtime_error("Trailing plan input");
 cout<<"[";for(size_t q=0;q<cases.size();q++){auto& c=cases[q];vector<uint64_t> times;vector<Answer> answers;int kernel=0;
  for(int r=0;r<repeats;r++){answers.clear();uint64_t start=clock_ns();{Context ctx(c);kernel=choose(ctx,plan);for(auto& t:c.targets)answers.push_back(ctx.solve(t,kernel));}times.push_back(clock_ns()-start);
   Context oracle(c);for(size_t i=0;i<answers.size();i++){auto [a,b]=answers[i];if((a>=0)!=bool(c.exists[i])||(a>=0&&!oracle.match(a,b,c.targets[i])))throw runtime_error("Incorrect result");}}
  if(q)cout<<",";cout<<"{\"id\":\""<<c.id<<"\",\"kernel\":"<<kernel<<",\"ns\":[";for(size_t r=0;r<times.size();r++){if(r)cout<<",";cout<<times[r];}cout<<"],\"answers\":[";
  for(size_t i=0;i<answers.size();i++){if(i)cout<<",";cout<<"["<<answers[i].first<<","<<answers[i].second<<"]";}cout<<"]}";
 }cout<<"]"<<endl;}
 }catch(const exception& e){cerr<<e.what()<<endl;return 3;}}
